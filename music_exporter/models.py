from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(slots=True)
class Track:
    title: str
    artists: str
    album: str
    platform: str
    resource_id: str
    playlist_name: str
    link: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


FIELDNAMES = [
    "title",
    "artists",
    "album",
    "platform",
    "resource_id",
    "playlist_name",
    "link",
]
