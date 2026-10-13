The one-click updater staged only the generated music JSON but used an unrestricted `git commit`, so unrelated changes that were already staged could be included in its automatic commit. The updater now checks and commits only `docs/data/music.json`; the README documents that behavior, adds reproducible clone/setup steps, and separates the MIT code license from third-party music metadata rights.

Validation:

- `python -m unittest discover -s tests -v` — 9 passed
- New regression test verifies the path-scoped diff and `git commit --only` command
- `git diff --check`

No playlist service, browser cookies, media URLs, Git push, or live Pages deployment was used during testing.
