---
"@runfusion/fusion": minor
---

summary: Release notes open with AI Highlights, and the release script prints a ready-to-post engagement tweet.
category: feature
dev: distillReleaseNotes calls `claude -p --model sonnet` for Highlights + notes + ≤280-char X draft (engagement-oriented, varies per release); soft deterministic fallback if Claude is offline. release.mjs prints the draft after publish and on --dry-run.
