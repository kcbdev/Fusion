---
"@runfusion/fusion": patch
---

Fix GitHub PR modal/review fetches that call `gh api` through `runGhJsonAsync`.

`runGhJson` and `runGhJsonAsync` now skip auto-appending `--json` for the `gh api` subcommand (which already returns JSON and rejects that flag), preventing runtime `unknown flag: --json` errors when loading PR comments/reviews.
