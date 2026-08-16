from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

from music_exporter.cookies import apply_cookie_text, cookie_from_env, load_browser_cookies
from music_exporter.kuwo import KuwoAdapter
from music_exporter.netease import NeteaseAdapter
from music_exporter.output import deduplicate, write_outputs


def _configure_console() -> None:
    """Keep Chinese status/help text usable under different Windows code pages."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="导出网易云/酷我歌单元数据，合并去重并生成 CSV、JSON（不下载音频）"
    )
    parser.add_argument("--netease", action="append", default=[], metavar="URL_OR_ID", help="网易云歌单链接或 ID；可多次使用")
    parser.add_argument("--kuwo", action="append", default=[], metavar="URL_OR_ID", help="酷我歌单链接或 ID；可多次使用")
    parser.add_argument("--browser", choices=("edge", "chrome", "firefox"), help="读取指定浏览器的现有登录 Cookie")
    parser.add_argument("--output", type=Path, default=Path("output"), help="输出目录，默认 ./output")
    parser.add_argument("--no-dedupe", action="store_true", help="保留跨歌单重复曲目")
    parser.add_argument("--strict", action="store_true", help="任一歌单失败时立即停止且不输出")
    return parser


def configure_adapter(adapter, browser: str | None, domain: str, env_name: str) -> None:
    jar = load_browser_cookies(browser, domain)
    if jar:
        adapter.session.cookies.update(jar)
    apply_cookie_text(adapter.session.cookies, cookie_from_env(env_name), domain)


def main(argv: list[str] | None = None) -> int:
    _configure_console()
    args = build_parser().parse_args(argv)
    if not args.netease and not args.kuwo:
        print("错误：请至少提供一个 --netease 或 --kuwo 歌单链接/ID。", file=sys.stderr)
        return 2

    adapters = {"netease": NeteaseAdapter(), "kuwo": KuwoAdapter()}
    cookie_targets = []
    if args.netease:
        cookie_targets.append(("netease", ".music.163.com", "NETEASE"))
    if args.kuwo:
        cookie_targets.append(("kuwo", ".kuwo.cn", "KUWO"))
    for platform, domain, env_name in cookie_targets:
        try:
            configure_adapter(adapters[platform], args.browser, domain, env_name)
        except RuntimeError as exc:
            print(f"Cookie 提示 [{platform}]：{exc}", file=sys.stderr)
            if args.strict:
                return 1

    tracks = []
    failures: list[str] = []
    jobs = [("netease", item) for item in args.netease] + [("kuwo", item) for item in args.kuwo]
    for platform, value in jobs:
        try:
            exported = adapters[platform].export_playlist(value)
            tracks.extend(exported)
            print(f"[{platform}] {value}：取得 {len(exported)} 首")
        except (ValueError, RuntimeError, requests.RequestException) as exc:
            message = f"[{platform}] {value}：{exc}"
            failures.append(message)
            print(f"失败 {message}", file=sys.stderr)
            if args.strict:
                return 1

    if not tracks:
        print("没有取得任何曲目，未生成输出文件。", file=sys.stderr)
        return 1
    original_count = len(tracks)
    if not args.no_dedupe:
        tracks = deduplicate(tracks)
    csv_path, json_path = write_outputs(tracks, args.output)
    print(f"完成：{original_count} 条输入，输出 {len(tracks)} 条，去重 {original_count - len(tracks)} 条")
    print(f"CSV : {csv_path.resolve()}")
    print(f"JSON: {json_path.resolve()}")
    if failures:
        print(f"注意：另有 {len(failures)} 个歌单失败；成功内容已输出。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
