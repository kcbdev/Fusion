---
"@runfusion/fusion": minor
---

Add `worktrunk` settings group (`worktrunk.enabled`, `worktrunk.binaryPath`, `worktrunk.onFailure`) to both global (`~/.fusion/settings.json`) and project (`.fusion/config.json`) tiers, with field-level project-overrides-global precedence. CLI `fn settings set worktrunk.<field>` is supported in both scopes. This is settings plumbing only; the worktree backend that consumes these keys ships in a follow-up.
