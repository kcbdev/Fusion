---
"@runfusion/fusion": minor
---

Add workflow-native typed settings for triage/spec policy thresholds and routing defaults. The built-in defaults preserve current behavior: size bands remain S <2h, M 2-4h, L 4-8h; subtask signals use the canonical planning-prompt values of step threshold 7 and packages/modules threshold 3; file-scope/remediation thresholds remain 20 and 30.

These triage policy settings are new workflow settings, not moved project settings, so they are excluded from the U4 `MOVED_SETTINGS_KEYS` tombstone while still resolving through workflow effective settings.
