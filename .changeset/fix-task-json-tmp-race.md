---
"@runfusion/fusion": patch
---

Fix `ENOENT: ... rename 'task.json.tmp' -> 'task.json'` failures when two TaskStore instances (e.g. engine + dashboard server) write to the same task concurrently. The shared `task.json.tmp` filename caused one writer's `rename` to consume the tmp file and the other's to ENOENT. Each write now uses a unique tmp filename (`task.json.<pid>.<uuid>.tmp`) and cleans up its own tmp on rename failure.
