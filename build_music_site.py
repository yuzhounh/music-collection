from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CATEGORY_ORDER = ("流行歌曲", "外文歌曲", "影视原声", "纯音乐")


def sort_key(item: dict[str, object]) -> tuple[str, str]:
    title = unicodedata.normalize("NFKC", str(item.get("title") or "")).casefold()
    artists = unicodedata.normalize("NFKC", str(item.get("artists") or "")).casefold()
    return title, artists


def build_payload(input_path: Path) -> dict[str, object]:
    rows = json.loads(input_path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise ValueError("分类结果必须是歌曲列表")

    tracks: list[dict[str, object]] = []
    for index, row in enumerate(sorted(rows, key=sort_key), start=1):
        if not isinstance(row, dict):
            continue
        tracks.append(
            {
                "id": index,
                "title": str(row.get("title") or ""),
                "artists": str(row.get("artists") or ""),
                "album": str(row.get("album") or ""),
                "category": str(row.get("primary_category") or "其他/待复核"),
                "platforms": list(row.get("platforms") or []),
                "resource_ids": list(row.get("resource_ids") or []),
                "playlist_names": list(row.get("playlist_names") or []),
                "links": list(row.get("links") or []),
                "tags": list(row.get("tags") or []),
                "confidence": str(row.get("confidence") or ""),
                "needs_review": bool(row.get("needs_review")),
            }
        )

    counts = Counter(str(item["category"]) for item in tracks)
    memberships = sum(len(item["playlist_names"]) for item in tracks)
    platform_counts = Counter(platform for item in tracks for platform in item["platforms"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(tracks),
        "memberships": memberships,
        "categories": [
            {"key": category, "label": category, "count": counts.get(category, 0)}
            for category in CATEGORY_ORDER
            if counts.get(category, 0)
        ],
        "platform_counts": dict(platform_counts),
        "tracks": tracks,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="生成 GitHub Pages 音乐收藏静态站点数据")
    parser.add_argument(
        "--input", type=Path, default=Path("output/classified/all_music_classified.json")
    )
    parser.add_argument("--output", type=Path, default=Path("docs/data/music.json"))
    args = parser.parse_args()
    payload = build_payload(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"生成 {args.output.resolve()}：{payload['total']} 首")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
