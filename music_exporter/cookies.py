from __future__ import annotations

import os
from http.cookiejar import CookieJar


def load_browser_cookies(browser: str | None, domain: str) -> CookieJar | None:
    """Read an existing browser profile without ever asking for a password."""
    if not browser:
        return None
    try:
        import browser_cookie3
    except ImportError as exc:
        raise RuntimeError("缺少 browser-cookie3，请先运行 pip install -r requirements.txt") from exc

    loaders = {
        "chrome": browser_cookie3.chrome,
        "edge": browser_cookie3.edge,
        "firefox": browser_cookie3.firefox,
    }
    try:
        return loaders[browser](domain_name=domain)
    except Exception as exc:
        raise RuntimeError(
            f"无法读取 {browser} 的 {domain} Cookie。请先关闭浏览器后重试，"
            "或改用公开歌单链接。详细原因：{0}".format(exc)
        ) from exc


def apply_cookie_text(jar: CookieJar, cookie_text: str | None, domain: str) -> None:
    """Allow an explicit Cookie header as a last-resort, opt-in method."""
    if not cookie_text:
        return
    from requests.cookies import create_cookie

    for part in cookie_text.split(";"):
        if "=" not in part:
            continue
        name, value = part.strip().split("=", 1)
        if name:
            jar.set_cookie(create_cookie(name=name, value=value, domain=domain))


def cookie_from_env(platform: str) -> str | None:
    return os.environ.get(f"{platform.upper()}_COOKIE")
