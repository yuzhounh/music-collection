from __future__ import annotations

import json
import math
import random
import re
import uuid
from urllib.parse import parse_qs, urlparse

import requests

from .base import PlaylistAdapter
from .models import Track


class KuwoAdapter(PlaylistAdapter):
    platform = "kuwo"
    HOME = "https://www.kuwo.cn"
    LEGACY_PLAYLIST_API = "http://nplserver.kuwo.cn/pl.svc"
    HM_COOKIE = "Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324"

    @staticmethod
    def parse_playlist_id(value: str) -> str:
        value = value.strip()
        if value.isdigit():
            return value
        parsed = urlparse(value)
        query = parse_qs(parsed.query)
        for key in ("pid", "id"):
            found = query.get(key, [""])[0]
            if found.isdigit():
                return found
        match = re.search(r"(?:playlist_detail/|playlist/)(\d+)", value)
        if match:
            return match.group(1)
        raise ValueError(f"无法从酷我输入中识别歌单 ID：{value}")

    def _prepare_session(self, playlist_id: str) -> None:
        self.session.headers.update({"Referer": f"{self.HOME}/playlist_detail/{playlist_id}"})
        if not self.session.cookies.get(self.HM_COOKIE):
            self.session.get(self.HOME, timeout=self.timeout)
        secret = self._make_secret()
        if secret:
            self.session.headers.update({"Secret": secret})
        token = self.session.cookies.get("kw_token")
        if token:
            self.session.headers.update({"csrf": token})

    def _make_secret(self) -> str | None:
        """Create the request proof used by Kuwo's current public web pages."""
        cookie_value = self.session.cookies.get(self.HM_COOKIE)
        if not cookie_value:
            return None
        key = self.HM_COOKIE
        digits = "".join(str(ord(char)) for char in key)
        part = len(digits) // 5
        multiplier = int(
            "".join(
                digits[part * index] if part * index < len(digits) else ""
                for index in range(1, 6)
            )
        )
        increment = math.ceil(len(key) / 2)
        modulus = 2**31 - 1
        salt = round(1_000_000_000 * random.random()) % 100_000_000
        digits += str(salt)
        while len(digits) > 10:
            digits = str(int(digits[:10]) + int(digits[10:]))
        state = (multiplier * int(digits) + increment) % modulus
        encoded = ""
        for char in cookie_value:
            encoded += f"{ord(char) ^ math.floor(state / modulus * 255):02x}"
            state = (multiplier * state + increment) % modulus
        return encoded + f"{salt:x}".zfill(8)

    @staticmethod
    def _balanced_items(text: str, start: int) -> list[str]:
        """Return top-level JS object literals from an array in Nuxt SSR data."""
        items: list[str] = []
        depth = 0
        item_start = -1
        quote = ""
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = ""
                continue
            if char in ('"', "'"):
                quote = char
            elif char == "{":
                if depth == 0:
                    item_start = index
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0 and item_start >= 0:
                    items.append(text[item_start : index + 1])
                    item_start = -1
            elif char == "]" and depth == 0:
                break
        return items

    @staticmethod
    def _resolve_js_value(raw: str, variables: dict[str, object]) -> str:
        raw = raw.strip()
        if raw in variables:
            value = variables[raw]
        elif raw.startswith('"'):
            try:
                value = json.loads(raw)
            except ValueError:
                value = raw.strip('"')
        else:
            value = raw
        if value is None or isinstance(value, bool):
            return "" if value is None else str(value)
        return str(value)

    def _export_from_page(self, playlist_id: str) -> list[Track]:
        """Fallback to metadata embedded by Kuwo in its server-rendered page."""
        response = self.session.get(
            f"{self.HOME}/playlist_detail/{playlist_id}", timeout=self.timeout
        )
        response.raise_for_status()
        html = response.text
        wrapper = re.search(
            r"window\.__NUXT__=\(function\((?P<params>[^)]*)\)\{return .*?\}\((?P<args>.*?)\)\);</script>",
            html,
            flags=re.DOTALL,
        )
        variables: dict[str, object] = {}
        if wrapper:
            names = [name.strip() for name in wrapper.group("params").split(",")]
            try:
                values = json.loads("[" + wrapper.group("args") + "]")
                variables = dict(zip(names, values))
            except (ValueError, TypeError):
                variables = {}

        marker = html.find("musicList:[")
        if marker < 0:
            return []
        prefix = html[max(0, html.rfind("playListInfo:", 0, marker)) : marker]
        name_matches = re.findall(r"(?:^|,)name:([^,}\]]+)", prefix)
        playlist_name = (
            self._resolve_js_value(name_matches[-1], variables)
            if name_matches else f"酷我歌单 {playlist_id}"
        )
        items = self._balanced_items(html, marker + len("musicList:["))
        result: list[Track] = []
        for item in items:
            fields: dict[str, str] = {}
            for key in ("rid", "musicrid", "name", "artist", "album"):
                match = re.search(rf"(?:^|[,{{]){key}:([^,}}]+)", item)
                if match:
                    fields[key] = self._resolve_js_value(match.group(1), variables)
            resource_id = (fields.get("rid") or fields.get("musicrid") or "").replace("MUSIC_", "")
            if not fields.get("name") and not resource_id:
                continue
            result.append(
                Track(
                    title=fields.get("name", ""),
                    artists=fields.get("artist", ""),
                    album=fields.get("album", ""),
                    platform=self.platform,
                    resource_id=resource_id,
                    playlist_name=playlist_name,
                    link=f"{self.HOME}/play_detail/{resource_id}" if resource_id else "",
                )
            )
        return result

    def _export_from_legacy_api(self, playlist_id: str) -> list[Track]:
        """Read public playlists through Kuwo's PC-client metadata endpoint.

        Kuwo's current web API frequently rejects otherwise public playlists.
        The PC endpoint is still used by Kuwo-compatible clients and exposes
        metadata only; it does not request or download audio files.
        """
        page = 0
        # A large page avoids Kuwo's unstable page boundaries, where filtered
        # songs can shift between consecutive requests.
        page_size = 1000
        playlist_name = f"酷我歌单 {playlist_id}"
        result: list[Track] = []
        while True:
            response = self.session.get(
                self.LEGACY_PLAYLIST_API,
                params={
                    "op": "getlistinfo",
                    "pid": playlist_id,
                    "pn": page,
                    "rn": page_size,
                    "encode": "utf8",
                    "keyset": "pl2012",
                    "identity": "kuwo",
                    "pcmp4": 1,
                    "vipver": 1,
                    "newver": 1,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                # Some legacy records contain broken quoting in FSONGNAME even
                # though the canonical `name` field is valid. We do not use the
                # former, so neutralise it and retry instead of dropping the
                # entire 1000-song page.
                repaired, repair_count = re.subn(
                    r'("FSONGNAME"\s*:).*?(,\s*"MINFO"\s*:)',
                    r'\1""\2',
                    response.text,
                    flags=re.DOTALL,
                )
                if not repair_count:
                    raise RuntimeError("酷我 PC 接口返回了格式异常的数据") from exc
                try:
                    payload = json.loads(repaired)
                except ValueError as repair_exc:
                    raise RuntimeError("酷我 PC 接口返回了无法修复的格式异常数据") from repair_exc
            if str(payload.get("result", "ok")).lower() not in ("ok", "success", "1"):
                raise RuntimeError("酷我 PC 接口未返回有效歌单")

            playlist_name = str(payload.get("title") or playlist_name)
            songs = payload.get("musiclist") or []
            for song in songs:
                raw_id = song.get("id") or song.get("rid") or song.get("musicrid") or ""
                resource_id = str(raw_id).replace("MUSIC_", "")
                result.append(
                    Track(
                        title=str(song.get("name") or song.get("songName") or ""),
                        artists=str(song.get("artist") or song.get("artistName") or ""),
                        album=str(song.get("album") or song.get("albumName") or ""),
                        platform=self.platform,
                        resource_id=resource_id,
                        playlist_name=playlist_name,
                        link=f"{self.HOME}/play_detail/{resource_id}" if resource_id else "",
                    )
                )

            total = int(payload.get("total") or len(result))
            if not songs or len(result) >= total or len(songs) < page_size:
                break
            page += 1
        return result

    def export_playlist(self, value: str) -> list[Track]:
        playlist_id = self.parse_playlist_id(value)
        self._prepare_session(playlist_id)
        legacy_error: Exception | None = None
        try:
            legacy_result = self._export_from_legacy_api(playlist_id)
            if legacy_result:
                return legacy_result
        except (RuntimeError, requests.RequestException) as exc:
            legacy_error = exc

        page = 1
        playlist_name = f"酷我歌单 {playlist_id}"
        result: list[Track] = []
        while True:
            try:
                payload = self.get_json(
                    f"{self.HOME}/api/www/playlist/playListInfo",
                    params={
                        "pid": playlist_id,
                        "pn": page,
                        "rn": 100,
                        "httpsStatus": 1,
                        "reqId": str(uuid.uuid4()),
                        "plat": "web_www",
                    },
                )
            except (RuntimeError, requests.RequestException):
                payload = {}
            data = payload.get("data") or {}
            if payload.get("code") not in (None, 200) or not data:
                fallback = self._export_from_page(playlist_id)
                if fallback:
                    return fallback
                detail = f"；PC 接口错误：{legacy_error}" if legacy_error else ""
                raise RuntimeError(
                    "酷我未返回歌单；请确认链接/ID有效。私有内容可尝试 --browser edge 或 chrome"
                    + detail
                )
            playlist_name = str(data.get("name") or playlist_name)
            songs = data.get("musicList") or []
            for song in songs:
                raw_id = song.get("rid") or song.get("musicrid") or song.get("id") or ""
                resource_id = str(raw_id).replace("MUSIC_", "")
                result.append(
                    Track(
                        title=str(song.get("name") or song.get("songName") or ""),
                        artists=str(song.get("artist") or song.get("artistName") or ""),
                        album=str(song.get("album") or song.get("albumName") or ""),
                        platform=self.platform,
                        resource_id=resource_id,
                        playlist_name=playlist_name,
                        link=f"{self.HOME}/play_detail/{resource_id}" if resource_id else "",
                    )
                )
            total = int(data.get("total") or len(result))
            if not songs or len(result) >= total or len(songs) < 100:
                break
            page += 1
        return result
