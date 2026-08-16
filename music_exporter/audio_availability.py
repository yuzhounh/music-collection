from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable
from urllib.parse import urlparse

import requests


CATEGORY_ORDER = ("影视原声", "纯音乐", "外文歌曲", "流行歌曲", "其他/待复核")


def resource_id_for(row: dict[str, object], platform: str) -> str:
    prefix = f"{platform}:"
    for value in row.get("resource_ids") or []:
        text = str(value)
        if text.startswith(prefix) and text[len(prefix) :]:
            return text[len(prefix) :]
    return ""


def select_samples(
    rows: list[dict[str, object]], platform: str, count: int, excluded: set[tuple[str, str]] | None = None
) -> list[tuple[dict[str, object], str]]:
    """Select a deterministic, category-balanced sample for one platform."""
    excluded = excluded or set()
    groups: dict[str, list[tuple[dict[str, object], str]]] = defaultdict(list)
    for row in rows:
        key = (str(row.get("title") or ""), str(row.get("artists") or ""))
        resource_id = resource_id_for(row, platform)
        if resource_id and key not in excluded:
            groups[str(row.get("primary_category") or "其他/待复核")].append((row, resource_id))

    selected: list[tuple[dict[str, object], str]] = []
    offsets = defaultdict(int)
    while len(selected) < count:
        progressed = False
        for category in CATEGORY_ORDER:
            offset = offsets[category]
            if offset < len(groups[category]):
                selected.append(groups[category][offset])
                offsets[category] += 1
                progressed = True
                if len(selected) == count:
                    break
        if not progressed:
            break
    return selected


def _base_result(platform: str, resource_id: str) -> dict[str, object]:
    return {
        "platform": platform,
        "resource_id": resource_id,
        "available": False,
        "status": "error",
        "http_status": "",
        "provider_code": "",
        "fee_flag": "",
        "paid_flag": "",
        "free_trial": "",
        "audio_type": "",
        "bitrate": "",
        "size_bytes": "",
        "expires_seconds": "",
        "access_hint": "未知",
        "reason": "",
        "stream_host": "",
        "stream_url": "",
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def probe_netease(session: requests.Session, resource_id: str, timeout: int = 20) -> dict[str, object]:
    result = _base_result("netease", resource_id)
    try:
        response = session.get(
            "https://music.163.com/api/song/enhance/player/url",
            params={"ids": json.dumps([int(resource_id)]), "br": 128000},
            headers={"Referer": "https://music.163.com/"},
            timeout=timeout,
        )
        result["http_status"] = response.status_code
        response.raise_for_status()
        payload = response.json()
        data = (payload.get("data") or [{}])[0]
        stream_url = str(data.get("url") or "")
        result.update(
            available=bool(stream_url) and data.get("code") == 200,
            status="available" if stream_url and data.get("code") == 200 else "unavailable",
            provider_code=data.get("code") or "",
            fee_flag=data.get("fee") if data.get("fee") is not None else "",
            paid_flag=data.get("payed") if data.get("payed") is not None else "",
            free_trial=bool(data.get("freeTrialInfo")),
            audio_type=str(data.get("type") or data.get("encodeType") or ""),
            bitrate=data.get("br") or "",
            size_bytes=data.get("size") or "",
            expires_seconds=data.get("expi") or "",
            access_hint=(
                "当前会话可播放"
                if stream_url
                else "可能需要登录/会员或歌曲当前不可用"
                if data.get("fee") or data.get("payed")
                else "当前接口未提供播放地址"
            ),
            reason=str(data.get("message") or "") if not stream_url else "",
            stream_host=urlparse(stream_url).hostname or "" if stream_url else "",
            stream_url=stream_url,
        )
    except (ValueError, TypeError, requests.RequestException) as exc:
        result["reason"] = str(exc)
    return result


def probe_kuwo(session: requests.Session, resource_id: str, timeout: int = 20) -> dict[str, object]:
    result = _base_result("kuwo", resource_id)
    try:
        response = session.get(
            "https://antiserver.kuwo.cn/anti.s",
            params={
                "type": "convert_url",
                "rid": f"MUSIC_{resource_id}",
                "format": "mp3",
                "response": "url",
            },
            headers={"Referer": f"https://www.kuwo.cn/play_detail/{resource_id}"},
            timeout=timeout,
        )
        result["http_status"] = response.status_code
        response.raise_for_status()
        stream_url = response.text.strip()
        if not stream_url.startswith(("http://", "https://")):
            result.update(status="unavailable", access_hint="当前接口未提供播放地址", reason=stream_url[:300])
            return result
        parsed = urlparse(stream_url)
        audio_type = parsed.path.rsplit(".", 1)[-1].lower() if "." in parsed.path else ""
        result.update(
            available=True,
            status="available",
            audio_type=audio_type,
            access_hint="当前公开接口可解析；会员等级与长期有效性未知",
            stream_host=parsed.hostname or "",
            stream_url=stream_url,
        )
    except requests.RequestException as exc:
        result["reason"] = str(exc)
    return result


def enrich_result(
    sample_no: int, row: dict[str, object], probe: dict[str, object]
) -> dict[str, object]:
    return {
        "sample_no": sample_no,
        "title": str(row.get("title") or ""),
        "artists": str(row.get("artists") or ""),
        "album": str(row.get("album") or ""),
        "category": str(row.get("primary_category") or ""),
        **probe,
    }


def counts_by_platform(results: Iterable[dict[str, object]]) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for platform in ("netease", "kuwo"):
        items = [item for item in results if item.get("platform") == platform]
        available = sum(bool(item.get("available")) for item in items)
        summary[platform] = {
            "tested": len(items),
            "available": available,
            "unavailable": len(items) - available,
        }
    return summary
