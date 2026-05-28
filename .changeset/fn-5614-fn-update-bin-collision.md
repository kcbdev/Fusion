---
"@runfusion/fusion": patch
---

Fix `fn update` npm EEXIST bin-link collisions by retrying once with `--force` and showing manual recovery guidance when the retry fails.
