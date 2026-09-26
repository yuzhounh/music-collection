import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build_music_site import build_payload
from merge_and_classify import merge_rows
from music_exporter.audio_availability import counts_by_platform, resource_id_for, select_samples
from music_exporter.kuwo import KuwoAdapter
from music_exporter.models import Track
from music_exporter.mv_fallback import choose_preferred, match_score, video_match_score
from music_exporter.netease import NeteaseAdapter
from music_exporter.output import deduplicate, write_outputs
from update_music_site import _git_push, build_export_command, compare_sites, site_content_changed


class CoreTests(unittest.TestCase):
    def test_git_push_commits_only_generated_music_data(self) -> None:
        with mock.patch("update_music_site._run") as run_mock, mock.patch(
            "update_music_site.subprocess.run"
        ) as subprocess_run:
            subprocess_run.return_value.returncode = 1
            _git_push(2, 1)

        subprocess_run.assert_called_once_with(
            ["git", "diff", "--cached", "--quiet", "--", "docs/data/music.json"],
            cwd=mock.ANY,
            check=False,
        )
        self.assertEqual(
            run_mock.call_args_list[0],
            mock.call(["git", "add", "--", "docs/data/music.json"]),
        )
        self.assertEqual(
            run_mock.call_args_list[1],
            mock.call(
                [
                    "git",
                    "commit",
                    "--only",
                    "-m",
                    mock.ANY,
                    "--",
                    "docs/data/music.json",
                ]
            ),
        )
        self.assertEqual(run_mock.call_args_list[2], mock.call(["git", "push"]))

    def test_update_site_command_and_diff(self) -> None:
        config = {
            "browser": None,
            "netease": [{"name": "喜欢", "url": "https://music.163.com/m/playlist?id=1"}],
            "kuwo": [{"name": "收藏", "url": "https://m.kuwo.cn/newh5app/playlist_detail/2"}],
        }
        command = build_export_command(config, Path("temporary"))
        self.assertIn("--strict", command)
        self.assertIn("--no-dedupe", command)
        self.assertIn("--netease", command)
        self.assertIn("--kuwo", command)
        before = {"tracks": [{"title": "旧歌", "artists": "歌手"}]}
        after = {"tracks": [{"title": "新歌", "artists": "歌手"}]}
        added, removed = compare_sites(before, after)
        self.assertEqual([item["title"] for item in added], ["新歌"])
        self.assertEqual([item["title"] for item in removed], ["旧歌"])
        same_before = {"generated_at": "old", "total": 1, "tracks": before["tracks"]}
        same_after = {"generated_at": "new", "total": 1, "tracks": before["tracks"]}
        self.assertFalse(site_content_changed(same_before, same_after))

    def test_music_site_payload(self):
        rows = [
            {
                "title": "晴天", "artists": "周杰伦", "album": "叶惠美",
                "primary_category": "流行歌曲", "platforms": ["netease"],
                "resource_ids": ["netease:1"], "playlist_names": ["流行歌曲"],
                "links": ["https://music.163.com/song?id=1"], "tags": [],
                "confidence": "高", "needs_review": False,
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "tracks.json"
            source.write_text(__import__("json").dumps(rows, ensure_ascii=False), encoding="utf-8")
            payload = build_payload(source)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["categories"][0]["label"], "流行歌曲")

    def test_id_parsing(self):
        self.assertEqual(NeteaseAdapter.parse_playlist_id("https://music.163.com/#/playlist?id=12345"), "12345")
        self.assertEqual(KuwoAdapter.parse_playlist_id("https://www.kuwo.cn/playlist_detail/67890"), "67890")
        self.assertEqual(
            KuwoAdapter.parse_playlist_id("https://m.kuwo.cn/newh5app/playlist_detail/3720866531?t=plantform"),
            "3720866531",
        )
        self.assertEqual(KuwoAdapter.parse_playlist_id("https://www.kuwo.cn/web/inventory/share?pid=456"), "456")

    def test_deduplicate_and_write(self):
        one = Track("晴天", "周杰伦", "叶惠美", "netease", "1", "A", "https://a")
        duplicate = Track(" 晴天！", "周杰伦", "", "kuwo", "2", "B", "https://b")
        tracks = deduplicate([one, duplicate])
        self.assertEqual(len(tracks), 1)
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = write_outputs(tracks, Path(directory))
            self.assertTrue(csv_path.exists())
            self.assertTrue(json_path.exists())
            self.assertIn("周杰伦", json_path.read_text(encoding="utf-8"))

    def test_kuwo_nuxt_helpers(self):
        source = '{rid:1,name:a,pay:{x:1}},{rid:2,name:"Song"}]'
        items = KuwoAdapter._balanced_items(source, 0)
        self.assertEqual(len(items), 2)
        self.assertEqual(KuwoAdapter._resolve_js_value("a", {"a": "歌曲"}), "歌曲")

    def test_merge_preserves_sources_and_categories(self):
        rows = [
            {
                "title": "晴天",
                "artists": "周杰伦",
                "album": "叶惠美",
                "platform": "netease",
                "resource_id": "1",
                "playlist_name": "流行歌曲",
                "link": "https://a",
            },
            {
                "title": " 晴天！",
                "artists": "周杰伦",
                "album": "",
                "platform": "kuwo",
                "resource_id": "2",
                "playlist_name": "我喜欢听",
                "link": "https://b",
            },
        ]
        tracks = merge_rows(rows)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["primary_category"], "流行歌曲")
        self.assertEqual(tracks[0]["platforms"], ["kuwo", "netease"])
        self.assertEqual(tracks[0]["membership_count"], 2)

    def test_audio_sample_selection_and_summary(self):
        rows = [
            {"title": "甲", "artists": "A", "primary_category": "流行歌曲", "resource_ids": ["netease:1"]},
            {"title": "乙", "artists": "B", "primary_category": "纯音乐", "resource_ids": ["netease:2", "kuwo:3"]},
            {"title": "丙", "artists": "C", "primary_category": "影视原声", "resource_ids": ["kuwo:4"]},
        ]
        self.assertEqual(resource_id_for(rows[1], "kuwo"), "3")
        selected = select_samples(rows, "netease", 2)
        self.assertEqual(len(selected), 2)
        summary = counts_by_platform(
            [
                {"platform": "netease", "available": True},
                {"platform": "netease", "available": False},
                {"platform": "kuwo", "available": True},
            ]
        )
        self.assertEqual(summary["netease"], {"tested": 2, "available": 1, "unavailable": 1})

    def test_mv_match_and_domestic_priority(self):
        self.assertGreaterEqual(match_score("A Little Story", "Valentin", "Valentin - A Little Story", "Valentin"), 85)
        self.assertGreaterEqual(video_match_score("A Gift of a Thistle", "Catrin Finch", "A Gift of a Thistle (Braveheart OST)"), 85)
        preferred = choose_preferred(
            [
                {"source": "YouTube", "playable": True, "match_score": 96},
                {"source": "网易云MV", "playable": True, "match_score": 88},
            ]
        )
        self.assertEqual(preferred["source"], "网易云MV")
        preferred = choose_preferred(
            [
                {"source": "YouTube", "playable": True, "match_score": 96},
                {"source": "网易云MV", "playable": True, "match_score": 78},
            ]
        )
        self.assertEqual(preferred["source"], "YouTube")


if __name__ == "__main__":
    unittest.main()
