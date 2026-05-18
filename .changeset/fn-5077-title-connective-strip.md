---
"@runfusion/fusion": patch
---

Fix malformed task titles when foreign FN-XXX tokens are stripped: dangling trailing connective words (e.g. "of", "to", "for") that would otherwise produce fragments like "Close as duplicate of" are now rejected, so token-stripped residuals never persist as task titles.
