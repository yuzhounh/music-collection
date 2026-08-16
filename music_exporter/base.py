from __future__ import annotations

from abc import ABC, abstractmethod

import requests

from .models import Track


class PlaylistAdapter(ABC):
    platform: str

    def __init__(self, timeout: int = 20) -> None:
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/124 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
            }
        )

    def get_json(self, url: str, **kwargs):
        response = self.session.get(url, timeout=self.timeout, **kwargs)
        response.raise_for_status()
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(f"{self.platform} 返回了非 JSON 内容，平台接口可能已变更") from exc

    @abstractmethod
    def export_playlist(self, value: str) -> list[Track]:
        raise NotImplementedError
