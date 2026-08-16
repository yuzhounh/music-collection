from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import requests

from music_exporter.audio_availability import (
    counts_by_platform,
    enrich_result,
    probe_kuwo,
    probe_netease,
    select_samples,
)
from music_exporter.cookies import apply_cookie_text, cookie_from_env, load_browser_cookies


CSV_FIELDS = [
    "sample_no", "title", "artists", "album", "category", "platform", "resource_id",
    "available", "status", "http_status", "provider_code", "fee_flag", "paid_flag", "free_trial",
    "audio_type", "bitrate", "size_bytes",
    "expires_seconds", "access_hint", "reason", "stream_host", "stream_url", "checked_at",
]


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="抽样检测网易云/酷我歌曲是否返回播放地址（只检测，不下载音频）"
    )
    result.add_argument(
        "--input", type=Path, default=Path("output/classified/all_music_classified.json"),
        help="分类结果 JSON",
    )
    result.add_argument("--output", type=Path, default=Path("output/audio_availability"), help="报告目录")
    result.add_argument("--per-platform", type=int, default=15, help="每个平台抽样数量，默认 15")
    result.add_argument("--browser", choices=("edge", "chrome", "firefox"), help="可选：读取浏览器登录态")
    result.add_argument("--timeout", type=int, default=20, help="单次请求超时秒数")
    return result


def configure_session(session: requests.Session, browser: str | None, domain: str, env_name: str) -> None:
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
        }
    )
    jar = load_browser_cookies(browser, domain)
    if jar:
        session.cookies.update(jar)
    apply_cookie_text(session.cookies, cookie_from_env(env_name), domain)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parser().parse_args(argv)
    if args.per_platform < 1:
        print("错误：--per-platform 必须大于 0", file=sys.stderr)
        return 2
    rows = json.loads(args.input.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        print("错误：输入文件必须是歌曲列表", file=sys.stderr)
        return 2

    sessions = {"netease": requests.Session(), "kuwo": requests.Session()}
    for platform, domain, env_name in (
        ("netease", ".music.163.com", "NETEASE"),
        ("kuwo", ".kuwo.cn", "KUWO"),
    ):
        try:
            configure_session(sessions[platform], args.browser, domain, env_name)
        except RuntimeError as exc:
            print(f"Cookie 提示 [{platform}]：{exc}", file=sys.stderr)

    netease_samples = select_samples(rows, "netease", args.per_platform)
    used = {(str(row.get("title") or ""), str(row.get("artists") or "")) for row, _ in netease_samples}
    kuwo_samples = select_samples(rows, "kuwo", args.per_platform, excluded=used)
    jobs = [("netease", row, rid) for row, rid in netease_samples]
    jobs += [("kuwo", row, rid) for row, rid in kuwo_samples]

    results: list[dict[str, object]] = []
    for index, (platform, row, resource_id) in enumerate(jobs, start=1):
        if platform == "netease":
            probe = probe_netease(sessions[platform], resource_id, args.timeout)
        else:
            probe = probe_kuwo(sessions[platform], resource_id, args.timeout)
        item = enrich_result(index, row, probe)
        results.append(item)
        marker = "可用" if item["available"] else "不可用"
        print(f"[{index:02d}/{len(jobs):02d}] {platform} {marker}：{item['title']} - {item['artists']}")

    args.output.mkdir(parents=True, exist_ok=True)
    csv_path = args.output / "audio_availability_sample.csv"
    json_path = args.output / "audio_availability_sample.json"
    summary_path = args.output / "summary.json"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(results)
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "mode": "availability-only; no audio downloaded",
        "input_tracks": len(rows),
        "requested_per_platform": args.per_platform,
        "results": counts_by_platform(results),
        "csv": str(csv_path.resolve()),
        "json": str(json_path.resolve()),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if results else 1


if __name__ == "__main__":
    raise SystemExit(main())
