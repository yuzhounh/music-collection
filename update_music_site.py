from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "playlists.json"
SITE_DATA = ROOT / "docs" / "data" / "music.json"
RAW_OUTPUT = ROOT / "output" / "all_playlists_raw"
CLASSIFIED_OUTPUT = ROOT / "output" / "classified"


def _configure_console() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def _run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    shown = " ".join(f'"{part}"' if " " in part else part for part in command)
    print(f"\n> {shown}")
    return subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
    )


def _load_config(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for platform in ("netease", "kuwo"):
        entries = payload.get(platform)
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"配置中的 {platform} 歌单不能为空")
        for entry in entries:
            if not isinstance(entry, dict) or not str(entry.get("url", "")).strip():
                raise ValueError(f"{platform} 中存在没有 URL 的歌单配置")
    ratio = float(payload.get("minimum_retention_ratio", 0.75))
    if not 0 < ratio <= 1:
        raise ValueError("minimum_retention_ratio 必须大于 0 且不超过 1")
    payload["minimum_retention_ratio"] = ratio
    return payload


def build_export_command(config: dict[str, Any], output: Path) -> list[str]:
    command = [
        sys.executable,
        "export_playlists.py",
        "--no-dedupe",
        "--strict",
        "--output",
        str(output),
    ]
    browser = config.get("browser")
    if browser:
        command.extend(["--browser", str(browser)])
    for platform in ("netease", "kuwo"):
        for entry in config[platform]:
            command.extend([f"--{platform}", str(entry["url"])])
    return command


def _load_site(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"total": 0, "tracks": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _track_key(track: dict[str, Any]) -> tuple[str, str]:
    return (
        str(track.get("title", "")).strip().casefold(),
        str(track.get("artists", "")).strip().casefold(),
    )


def compare_sites(before: dict[str, Any], after: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    before_map = {_track_key(track): track for track in before.get("tracks", [])}
    after_map = {_track_key(track): track for track in after.get("tracks", [])}
    added = [after_map[key] for key in sorted(after_map.keys() - before_map.keys())]
    removed = [before_map[key] for key in sorted(before_map.keys() - after_map.keys())]
    return added, removed


def _copy_directory_files(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if item.is_file():
            shutil.copy2(item, destination / item.name)


def _install_results(raw: Path, classified: Path, site_data: Path) -> None:
    _copy_directory_files(raw, RAW_OUTPUT)
    _copy_directory_files(classified, CLASSIFIED_OUTPUT)
    SITE_DATA.parent.mkdir(parents=True, exist_ok=True)
    staged_site = SITE_DATA.with_suffix(".json.new")
    shutil.copy2(site_data, staged_site)
    os.replace(staged_site, SITE_DATA)


def _print_changes(added: list[dict[str, Any]], removed: list[dict[str, Any]], total: int) -> None:
    print("\n更新结果")
    print(f"  新增：{len(added)} 首")
    print(f"  删除：{len(removed)} 首")
    print(f"  当前：{total} 首")
    if added:
        print("  新增示例：")
        for track in added[:10]:
            print(f"    + {track.get('title', '')} — {track.get('artists', '')}")
    if removed:
        print("  删除示例：")
        for track in removed[:10]:
            print(f"    - {track.get('title', '')} — {track.get('artists', '')}")


def _git_push(added_count: int, removed_count: int) -> None:
    if not (ROOT / ".git").exists():
        print("\n尚未初始化 Git 仓库，已完成本地更新但跳过推送。")
        return
    _run(["git", "add", "--", "docs/data/music.json"])
    changed = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ROOT, check=False
    ).returncode
    if changed == 0:
        print("\n网页数据没有变化，无需提交或推送。")
        return
    message = f"Update music collection (+{added_count}/-{removed_count}) {date.today().isoformat()}"
    _run(["git", "commit", "-m", message])
    _run(["git", "push"])
    print("\n已推送 GitHub；GitHub Pages 通常会在数分钟内完成更新。")


def main() -> int:
    _configure_console()
    parser = argparse.ArgumentParser(description="重新抓取歌单、分类并更新音乐收藏网页")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--push", action="store_true", help="更新成功后提交并推送网页数据")
    parser.add_argument(
        "--allow-large-removal",
        action="store_true",
        help="允许新结果低于旧数据的安全保留比例",
    )
    args = parser.parse_args()

    try:
        config = _load_config(args.config.resolve())
        before = _load_site(SITE_DATA)
        work_root = ROOT / "work"
        work_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="music_update_", dir=work_root) as temp_name:
            temp = Path(temp_name)
            raw = temp / "raw"
            classified = temp / "classified"
            site_data = temp / "music.json"
            _run(build_export_command(config, raw))
            _run(
                [
                    sys.executable,
                    "merge_and_classify.py",
                    str(raw / "favorites_merged.json"),
                    "--output",
                    str(classified),
                ]
            )
            _run(
                [
                    sys.executable,
                    "build_music_site.py",
                    "--input",
                    str(classified / "all_music_classified.json"),
                    "--output",
                    str(site_data),
                ]
            )
            after = _load_site(site_data)
            old_total = int(before.get("total", 0))
            new_total = int(after.get("total", 0))
            minimum = int(old_total * config["minimum_retention_ratio"])
            if old_total and new_total < minimum and not args.allow_large_removal:
                raise RuntimeError(
                    f"安全检查未通过：新结果仅 {new_total} 首，低于原有 {old_total} 首的 "
                    f"{config['minimum_retention_ratio']:.0%}。原网页未被覆盖。"
                )
            if new_total <= 0:
                raise RuntimeError("没有抓取到任何歌曲，原网页未被覆盖")
            added, removed = compare_sites(before, after)
            _install_results(raw, classified, site_data)

        _print_changes(added, removed, new_total)
        if args.push:
            _git_push(len(added), len(removed))
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"\n更新失败：{exc}", file=sys.stderr)
        print("原网页数据已保留，请检查网络或歌单权限后重试。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
