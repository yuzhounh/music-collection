from __future__ import annotations

import ast
import html
import json
import re
import unicodedata
from difflib import SequenceMatcher
from urllib.parse import urlparse

import requests


def _normalise(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^\w]+", "", value, flags=re.UNICODE)


def match_score(title: str, artists: str, candidate_title: str, candidate_artist: str) -> int:
    wanted_title = _normalise(title)
    found_title = _normalise(candidate_title)
    if not wanted_title or not found_title:
        return 0
    title_score = SequenceMatcher(None, wanted_title, found_title).ratio()
    if wanted_title in found_title or found_title in wanted_title:
        title_score = max(title_score, 0.92)
    wanted_artists = [_normalise(part) for part in re.split(r"[/、;&，；]+", artists) if _normalise(part)]
    found_artist = _normalise(candidate_artist)
    artist_score = max((SequenceMatcher(None, artist, found_artist).ratio() for artist in wanted_artists), default=0)
    return round(75 * title_score + 25 * artist_score)


def video_match_score(title: str, artists: str, candidate_title: str) -> int:
    """Score user-uploaded video titles where uploader is usually not the recording artist."""
    wanted_title = _normalise(title)
    found_title = _normalise(candidate_title)
    if not wanted_title or not found_title:
        return 0
    title_score = SequenceMatcher(None, wanted_title, found_title).ratio()
    if wanted_title in found_title:
        title_score = max(title_score, 0.92)
    artist_bonus = 0
    for part in re.split(r"[/、;&，；]+", artists):
        artist = _normalise(part)
        if artist and artist in found_title:
            artist_bonus = 8
            break
    return min(100, round(100 * title_score) + artist_bonus)


def _candidate(
    source: str,
    candidate_id: str,
    title: str,
    artist: str,
    page_url: str,
    playable: bool,
    score: int,
    notes: str = "",
) -> dict[str, object]:
    return {
        "source": source,
        "candidate_id": candidate_id,
        "candidate_title": title,
        "candidate_artist": artist,
        "page_url": page_url,
        "playable": playable,
        "match_score": score,
        "needs_review": (
            score < 85
            or source in {"哔哩哔哩", "YouTube"}
            or bool(re.search(r"(?:cover|翻唱|翻奏|伴奏|吉他手|演奏)", title, re.I))
        ),
        "notes": notes,
    }


def search_netease_mv(
    session: requests.Session, title: str, artists: str, resource_id: str, timeout: int = 20
) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    seen: set[str] = set()

    def add_mv(mv_id: object, linked: bool = False) -> None:
        mv_id = str(mv_id or "")
        if not mv_id or mv_id == "0" or mv_id in seen:
            return
        seen.add(mv_id)
        response = session.get(
            "https://music.163.com/api/mv/detail",
            params={"id": mv_id, "type": "mp4"},
            headers={"Referer": "https://music.163.com/"},
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json().get("data") or {}
        candidate_title = str(data.get("name") or "")
        candidate_artist = str(data.get("artistName") or "")
        score = match_score(title, artists, candidate_title, candidate_artist)
        candidates.append(
            _candidate(
                "网易云MV",
                mv_id,
                candidate_title,
                candidate_artist,
                f"https://music.163.com/#/mv?id={mv_id}",
                bool(data.get("brs")),
                score,
                "原歌曲关联MV" if linked else "网易云MV搜索结果",
            )
        )

    try:
        if resource_id:
            response = session.get(
                "https://music.163.com/api/song/detail",
                params={"ids": json.dumps([int(resource_id)])},
                headers={"Referer": "https://music.163.com/"},
                timeout=timeout,
            )
            response.raise_for_status()
            songs = response.json().get("songs") or []
            if songs:
                add_mv(songs[0].get("mvid"), linked=True)

        response = session.get(
            "https://music.163.com/api/search/get",
            params={"s": f"{title} {artists}", "type": 1004, "limit": 5, "offset": 0},
            headers={"Referer": "https://music.163.com/"},
            timeout=timeout,
        )
        response.raise_for_status()
        mvs = ((response.json().get("result") or {}).get("mvs") or [])
        ranked = sorted(
            mvs,
            key=lambda item: match_score(
                title, artists, str(item.get("name") or ""), str(item.get("artistName") or "")
            ),
            reverse=True,
        )
        for item in ranked[:2]:
            if match_score(title, artists, str(item.get("name") or ""), str(item.get("artistName") or "")) >= 45:
                add_mv(item.get("id"))
    except (ValueError, TypeError, requests.RequestException):
        pass
    return candidates


def _parse_kuwo_search(text: str) -> dict[str, object]:
    try:
        return json.loads(text)
    except ValueError:
        try:
            value = ast.literal_eval(text)
            return value if isinstance(value, dict) else {}
        except (ValueError, SyntaxError):
            return {}


def _clean_kuwo(value: object) -> str:
    text = html.unescape(str(value or "")).replace("\\u0026", "&")
    return re.sub(r"<[^>]+>", "", text).strip()


def search_kuwo_mv(
    session: requests.Session, title: str, artists: str, timeout: int = 20
) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    try:
        response = session.get(
            "http://search.kuwo.cn/r.s",
            params={
                "all": f"{title} {artists}", "ft": "music", "itemset": "web_2013", "client": "kt",
                "pn": 0, "rn": 15, "rformat": "json", "encoding": "utf8",
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = _parse_kuwo_search(response.text)
        for item in payload.get("abslist") or []:
            mv_id = str(item.get("MKVRID") or "").replace("MV_", "")
            if str(item.get("MVFLAG") or "0") != "1" or not mv_id or mv_id == "0":
                continue
            candidate_title = _clean_kuwo(item.get("SONGNAME") or item.get("NAME"))
            candidate_artist = _clean_kuwo(item.get("ARTIST"))
            score = match_score(title, artists, candidate_title, candidate_artist)
            if score < 45:
                continue
            stream = session.get(
                "https://antiserver.kuwo.cn/anti.s",
                params={"type": "convert_url", "rid": f"MV_{mv_id}", "format": "mp4", "response": "url"},
                timeout=timeout,
            )
            stream_url = stream.text.strip() if stream.ok else ""
            music_id = str(item.get("MUSICRID") or "").replace("MUSIC_", "")
            candidates.append(
                _candidate(
                    "酷我MV",
                    mv_id,
                    candidate_title,
                    candidate_artist,
                    f"https://m.kuwo.cn/newh5app/mvplay/7/{music_id}?type=7",
                    stream_url.startswith(("http://", "https://")),
                    score,
                    "酷我歌曲搜索中的MV标记",
                )
            )
    except (ValueError, TypeError, requests.RequestException):
        pass
    return candidates


def search_bilibili_video(
    session: requests.Session, title: str, artists: str, timeout: int = 20
) -> tuple[list[dict[str, object]], str]:
    try:
        response = session.get(
            "https://api.bilibili.com/x/web-interface/search/type",
            params={"search_type": "video", "keyword": f"{title} {artists} MV", "page": 1},
            headers={"Referer": "https://search.bilibili.com/"},
            timeout=timeout,
        )
        if response.status_code == 412:
            return [], "哔哩哔哩搜索接口触发 412 风控"
        response.raise_for_status()
        payload = response.json()
        results = (payload.get("data") or {}).get("result") or []
        candidates: list[dict[str, object]] = []
        for item in results[:5]:
            candidate_title = re.sub(r"<[^>]+>", "", str(item.get("title") or ""))
            candidate_artist = str(item.get("author") or "")
            score = video_match_score(title, artists, candidate_title)
            if score >= 55:
                bvid = str(item.get("bvid") or "")
                candidates.append(
                    _candidate(
                        "哔哩哔哩",
                        bvid,
                        candidate_title,
                        candidate_artist,
                        f"https://www.bilibili.com/video/{bvid}" if bvid else str(item.get("arcurl") or ""),
                        bool(bvid),
                        score,
                        "搜索结果页面可访问性未逐个播放验证",
                    )
                )
        return candidates, ""
    except (ValueError, TypeError, requests.RequestException) as exc:
        return [], f"哔哩哔哩搜索失败：{exc}"


def search_youtube_video(title: str, artists: str) -> list[dict[str, object]]:
    try:
        import yt_dlp
    except ImportError:
        return []
    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "playlistend": 3,
        "socket_timeout": 20,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            payload = ydl.extract_info(f"ytsearch3:{title} {artists} official video", download=False)
        candidates: list[dict[str, object]] = []
        for item in payload.get("entries") or []:
            if not item:
                continue
            candidate_title = str(item.get("title") or "")
            candidate_artist = str(item.get("channel") or item.get("uploader") or "")
            score = video_match_score(title, artists, candidate_title)
            if score < 55:
                continue
            video_id = str(item.get("id") or "")
            candidates.append(
                _candidate(
                    "YouTube",
                    video_id,
                    candidate_title,
                    candidate_artist,
                    f"https://www.youtube.com/watch?v={video_id}",
                    bool(video_id),
                    score,
                    "只验证搜索结果存在，未下载或提取视频音轨",
                )
            )
        return candidates
    except Exception:
        return []


def choose_preferred(candidates: list[dict[str, object]]) -> dict[str, object] | None:
    playable = [item for item in candidates if item.get("playable")]
    if not playable:
        return None
    domestic = [item for item in playable if item.get("source") != "YouTube" and int(item.get("match_score") or 0) >= 85]
    foreign = [item for item in playable if item.get("source") == "YouTube" and int(item.get("match_score") or 0) >= 85]
    pool = domestic or foreign or playable
    return max(pool, key=lambda item: int(item.get("match_score") or 0))
