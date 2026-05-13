---
"@runfusion/fusion": patch
---

Suppress transient auto-merge failure surfacing: `failed` notifications now wait through a grace window and are dropped when self-healing confirms recovery, while persistent failures still notify. Non-conflict auto-merge failures are now logged to task history instead of persisting a hard-failure user comment.
