from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urlparse

from .base import PlaylistAdapter
from .models import Track


class NeteaseAdapter(PlaylistAdapter):
    platform = "netease"
    API = "https://music.163.com"

    @staticmethod
    def parse_playlist_id(value: str) -> str:
        value = value.strip()
        if value.isdigit():
            return value
        parsed = urlparse(value)
        query_id = parse_qs(parsed.query).get("id", [""])[0]
        if query_id.isdigit():
            return query_id
        match = re.search(r"(?:playlist/|playlist\?id=)(\d+)", value)
        if match:
            return match.group(1)
        raise ValueError(f"无法从网易云输入中识别歌单 ID：{value}")

    def export_playlist(self, value: str) -> list[Track]:
        playlist_id = self.parse_playlist_id(value)
        payload = self.get_json(
            f"{self.API}/api/v6/playlist/detail",
            params={"id": playlist_id, "n": 100000, "s": 0},
            headers={"Referer": f"{self.API}/playlist?id={playlist_id}"},
        )
        playlist = payload.get("playlist") or payload.get("result")
        if not playlist:
            raise RuntimeError("网易云未返回歌单；若它是私有歌单，请使用 --browser 读取登录态")

        # The detail endpoint often embeds only a handful of complete songs even
        # though trackIds contains the full public playlist. Fetch details in
        # small batches: very large GET query strings are silently truncated.
        ordered_ids = [
            item.get("id") for item in playlist.get("trackIds", [])
            if item.get("id") is not None
        ]
        songs_by_id = {
            str(song.get("id")): song for song in (playlist.get("tracks") or [])
            if song.get("id") is not None
        }
        for start in range(0, len(ordered_ids), 100):
            ids = ordered_ids[start : start + 100]
            details = self.get_json(
                f"{self.API}/api/song/detail",
                params={"ids": json.dumps(ids, separators=(",", ":"))},
                headers={"Referer": self.API},
            )
            for song in details.get("songs") or []:
                if song.get("id") is not None:
                    songs_by_id[str(song.get("id"))] = song
        tracks = [songs_by_id[str(song_id)] for song_id in ordered_ids if str(song_id) in songs_by_id]

        playlist_name = str(playlist.get("name") or f"网易云歌单 {playlist_id}")
        result: list[Track] = []
        for song in tracks:
            song_id = str(song.get("id") or "")
            artists = song.get("ar") or song.get("artists") or []
            album_obj = song.get("al") or song.get("album") or {}
            result.append(
                Track(
                    title=str(song.get("name") or ""),
                    artists=" / ".join(str(a.get("name") or "") for a in artists),
                    album=str(album_obj.get("name") or ""),
                    platform=self.platform,
                    resource_id=song_id,
                    playlist_name=playlist_name,
                    link=f"{self.API}/song?id={song_id}" if song_id else "",
                )
            )
        return result
