from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path


EXPLICIT_CATEGORY = {
    "流行歌曲": "流行歌曲",
    "流行": "流行歌曲",
    "外文歌曲": "外文歌曲",
    "外文": "外文歌曲",
    "轻音乐": "纯音乐",
    "影视歌曲": "影视原声",
    "影视": "影视原声",
}
CATEGORY_PRIORITY = ["影视原声", "纯音乐", "外文歌曲", "流行歌曲", "其他/待复核"]
FILM_KEYWORDS = ("原声", "ost", "soundtrack", "电影", "电视剧", "影视", "主题曲", "插曲", "片尾曲", "片头曲", "动画")
LIGHT_KEYWORDS = (
    "纯音乐", "轻音乐", "钢琴", "古琴", "小提琴", "大提琴", "萨克斯", "二胡", "笛子",
    "instrumental", "piano", "violin", "guitar", "bandari", "yiruma", "理查德·克莱德曼",
)

CSV_FIELDS = [
    "title", "artists", "album", "primary_category", "categories", "tags",
    "confidence", "classification_basis", "needs_review", "platforms",
    "resource_ids", "playlist_names", "links", "membership_count",
]


def _configure_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _normalise(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^\w]+", "", value, flags=re.UNICODE)


def _normalise_artists(value: str) -> str:
    parts = re.split(r"\s*(?:/|&|、|,|，|;|；|\+|＋|·|•)\s*", value)
    normalised = sorted(filter(None, (_normalise(part) for part in parts)))
    return "|".join(normalised)


def _dedupe_key(row: dict[str, object]) -> tuple[str, str]:
    title = _normalise(str(row.get("title") or ""))
    artists = _normalise_artists(str(row.get("artists") or ""))
    if title:
        return title, artists
    return str(row.get("platform") or ""), str(row.get("resource_id") or "")


def _script_category(text: str) -> str:
    latin = len(re.findall(r"[A-Za-z]", text))
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    kana = len(re.findall(r"[\u3040-\u30ff]", text))
    hangul = len(re.findall(r"[\uac00-\ud7af]", text))
    other_alphabet = len(re.findall(r"[\u0370-\u052f\u0590-\u06ff]", text))
    total = latin + han + kana + hangul + other_alphabet
    if kana or hangul or other_alphabet or (latin >= 3 and total and latin / total >= 0.65):
        return "外文歌曲"
    if han:
        return "流行歌曲"
    return "其他/待复核"


def _classify(record: dict[str, object]) -> tuple[str, list[str], str, str, bool, list[str]]:
    playlists = record["playlist_names"]
    explicit = {EXPLICIT_CATEGORY[name] for name in playlists if name in EXPLICIT_CATEGORY}
    text = " ".join(
        [str(record.get("title") or ""), str(record.get("artists") or ""), str(record.get("album") or "")]
    )
    folded = unicodedata.normalize("NFKC", text).casefold()

    if explicit:
        categories = [name for name in CATEGORY_PRIORITY if name in explicit]
        primary = categories[0]
        basis = "原歌单归属"
        confidence = "高"
        needs_review = len(explicit) > 1
    elif any(keyword in folded for keyword in FILM_KEYWORDS):
        primary, categories, basis, confidence, needs_review = (
            "影视原声", ["影视原声"], "标题/专辑关键词", "中", False
        )
    elif any(keyword in folded for keyword in LIGHT_KEYWORDS):
        primary, categories, basis, confidence, needs_review = (
            "纯音乐", ["纯音乐"], "标题/艺人/专辑关键词", "中", False
        )
    else:
        primary = _script_category(text)
        categories = [primary]
        basis = "文字语言启发式" if primary == "外文歌曲" else "默认归类"
        confidence = "中" if primary == "外文歌曲" else "低"
        needs_review = confidence == "低" or primary == "其他/待复核"

    tags: list[str] = []
    if re.search(r"(?:\blive\b|现场)", folded):
        tags.append("现场版")
    if re.search(r"(?:\bcover\b|翻唱)", folded):
        tags.append("翻唱")
    if re.search(r"(?:伴奏|instrumental)", folded):
        tags.append("伴奏/器乐")
    if len(record["platforms"]) > 1:
        tags.append("多平台")
    return primary, categories, basis, confidence, needs_review, tags


def _load_rows(paths: list[Path]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(payload, list):
            raise ValueError(f"输入必须是歌曲列表：{path}")
        rows.extend(item for item in payload if isinstance(item, dict))
    return rows


def merge_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    merged: dict[tuple[str, str], dict[str, object]] = {}
    for row in rows:
        key = _dedupe_key(row)
        platform = str(row.get("platform") or "")
        resource_id = str(row.get("resource_id") or "")
        playlist = str(row.get("playlist_name") or "")
        link = str(row.get("link") or "")
        if key not in merged:
            merged[key] = {
                "title": str(row.get("title") or ""),
                "artists": str(row.get("artists") or ""),
                "album": str(row.get("album") or ""),
                "platforms": set(),
                "resource_ids": set(),
                "playlist_names": set(),
                "links": set(),
                "membership_count": 0,
            }
        item = merged[key]
        if not item["album"] and row.get("album"):
            item["album"] = str(row["album"])
        if platform:
            item["platforms"].add(platform)
        if platform and resource_id:
            item["resource_ids"].add(f"{platform}:{resource_id}")
        if playlist:
            item["playlist_names"].add(playlist)
        if link:
            item["links"].add(link)
        item["membership_count"] += 1

    result: list[dict[str, object]] = []
    for item in merged.values():
        for field in ("platforms", "resource_ids", "playlist_names", "links"):
            item[field] = sorted(item[field])
        primary, categories, basis, confidence, needs_review, tags = _classify(item)
        item.update(
            primary_category=primary,
            categories=categories,
            classification_basis=basis,
            confidence=confidence,
            needs_review=needs_review,
            tags=tags,
        )
        result.append(item)
    result.sort(key=lambda item: (CATEGORY_PRIORITY.index(item["primary_category"]), _normalise(item["title"])))
    return result


def _csv_row(item: dict[str, object]) -> dict[str, object]:
    row = dict(item)
    for field in ("categories", "tags", "platforms", "resource_ids", "playlist_names", "links"):
        row[field] = "；".join(str(value) for value in row[field])
    row["needs_review"] = "是" if row["needs_review"] else "否"
    return {field: row.get(field, "") for field in CSV_FIELDS}


def _write_csv(path: Path, items: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(_csv_row(item) for item in items)


def main(argv: list[str] | None = None) -> int:
    _configure_console()
    parser = argparse.ArgumentParser(description="合并、去重并归类多个歌单 JSON 导出文件")
    parser.add_argument("inputs", nargs="+", type=Path, help="一个或多个导出的 JSON 文件")
    parser.add_argument("--output", type=Path, default=Path("output/classified"))
    args = parser.parse_args(argv)

    rows = _load_rows(args.inputs)
    merged = merge_rows(rows)
    args.output.mkdir(parents=True, exist_ok=True)
    _write_csv(args.output / "all_music_classified.csv", merged)
    for category in CATEGORY_PRIORITY:
        safe_name = category.replace("/", "_")
        _write_csv(
            args.output / f"category_{safe_name}.csv",
            [item for item in merged if item["primary_category"] == category],
        )
    (args.output / "all_music_classified.json").write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    counts = Counter(str(item["primary_category"]) for item in merged)
    summary = {
        "raw_memberships": len(rows),
        "unique_tracks": len(merged),
        "duplicates_collapsed": len(rows) - len(merged),
        "needs_review": sum(bool(item["needs_review"]) for item in merged),
        "category_counts": {category: counts.get(category, 0) for category in CATEGORY_PRIORITY},
    }
    (args.output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
