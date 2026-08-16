from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import requests

from music_exporter.mv_fallback import (
    choose_preferred,
    search_bilibili_video,
    search_kuwo_mv,
    search_netease_mv,
    search_youtube_video,
)


FIELDS = [
    "sample_no", "title", "artists", "original_platform", "original_resource_id",
    "candidate_found", "preferred_source", "candidate_title", "candidate_artist",
    "match_score", "playable", "needs_review", "page_url", "domestic_search_note",
]


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="为音频不可用歌曲检索可播放MV/视频候选；国内来源优先，不下载视频或音轨"
    )
    result.add_argument(
        "--input", type=Path,
        default=Path("output/audio_availability/audio_availability_sample.csv"),
        help="音频可用性检测 CSV",
    )
    result.add_argument("--output", type=Path, default=Path("output/mv_fallback"), help="报告目录")
    result.add_argument("--timeout", type=int, default=20)
    return result


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parser().parse_args(argv)
    with args.input.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if str(row.get("available") or "").lower() != "true"]

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
        }
    )
    reports: list[dict[str, object]] = []
    details: list[dict[str, object]] = []
    for index, row in enumerate(rows, start=1):
        title = str(row.get("title") or "")
        artists = str(row.get("artists") or "")
        resource_id = str(row.get("resource_id") or "") if row.get("platform") == "netease" else ""
        candidates = search_netease_mv(session, title, artists, resource_id, args.timeout)
        candidates += search_kuwo_mv(session, title, artists, args.timeout)
        bilibili, domestic_note = search_bilibili_video(session, title, artists, args.timeout)
        candidates += bilibili

        domestic_good = any(
            item.get("playable") and int(item.get("match_score") or 0) >= 85
            and item.get("source") != "YouTube"
            for item in candidates
        )
        if not domestic_good:
            candidates += search_youtube_video(title, artists)
        preferred = choose_preferred(candidates)
        if preferred:
            candidate_title = str(preferred.get("candidate_title") or "")
            version_mismatch = (
                ("live" in title.casefold() or "现场" in title)
                and "live" not in candidate_title.casefold()
                and "现场" not in candidate_title
            )
            report = {
                "sample_no": row.get("sample_no") or index,
                "title": title,
                "artists": artists,
                "original_platform": row.get("platform") or "",
                "original_resource_id": row.get("resource_id") or "",
                "candidate_found": True,
                "preferred_source": preferred.get("source") or "",
                "candidate_title": candidate_title,
                "candidate_artist": preferred.get("candidate_artist") or "",
                "match_score": preferred.get("match_score") or 0,
                "playable": preferred.get("playable") or False,
                "needs_review": bool(preferred.get("needs_review")) or version_mismatch,
                "page_url": preferred.get("page_url") or "",
                "domestic_search_note": domestic_note,
            }
        else:
            report = {
                "sample_no": row.get("sample_no") or index,
                "title": title,
                "artists": artists,
                "original_platform": row.get("platform") or "",
                "original_resource_id": row.get("resource_id") or "",
                "candidate_found": False,
                "preferred_source": "",
                "candidate_title": "",
                "candidate_artist": "",
                "match_score": 0,
                "playable": False,
                "needs_review": True,
                "page_url": "",
                "domestic_search_note": domestic_note,
            }
        reports.append(report)
        details.append({"track": {"title": title, "artists": artists}, "candidates": candidates})
        marker = f"{report['preferred_source']} {report['match_score']}分" if preferred else "未找到"
        print(f"[{index:02d}/{len(rows):02d}] {title} - {artists}：{marker}")

    args.output.mkdir(parents=True, exist_ok=True)
    csv_path = args.output / "mv_fallback_sample.csv"
    json_path = args.output / "mv_fallback_candidates.json"
    summary_path = args.output / "summary.json"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(reports)
    json_path.write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8")
    source_counts: dict[str, int] = {}
    for report in reports:
        source = str(report.get("preferred_source") or "未找到")
        source_counts[source] = source_counts.get(source, 0) + 1
    summary = {
        "mode": "MV/video discovery only; no video or audio downloaded",
        "unavailable_audio_tracks": len(rows),
        "candidate_found": sum(bool(item.get("candidate_found")) for item in reports),
        "needs_review": sum(bool(item.get("needs_review")) for item in reports),
        "preferred_sources": source_counts,
        "csv": str(csv_path.resolve()),
        "json": str(json_path.resolve()),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
