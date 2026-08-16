from __future__ import annotations

import csv
import json
import re
import unicodedata
from pathlib import Path

from .models import FIELDNAMES, Track


def _normalise(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^\w]+", "", value, flags=re.UNICODE)


def deduplicate(tracks: list[Track]) -> list[Track]:
    """Prefer title+artist; fall back to platform+resource ID when metadata is sparse."""
    seen: set[tuple[str, str]] = set()
    result: list[Track] = []
    for track in tracks:
        title, artists = _normalise(track.title), _normalise(track.artists)
        key = (title, artists) if title else (track.platform, track.resource_id)
        if key not in seen:
            seen.add(key)
            result.append(track)
    return result


def write_outputs(tracks: list[Track], output_dir: Path, stem: str = "favorites_merged") -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{stem}.csv"
    json_path = output_dir / f"{stem}.json"
    rows = [track.to_dict() for track in tracks]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)
    return csv_path, json_path
