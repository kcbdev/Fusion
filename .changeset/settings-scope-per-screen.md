---
"@runfusion/fusion": patch
---

summary: Settings show one Project/Global scope badge per screen, and Appearance splits into separate Global and Project screens.
category: fix
dev: Adds SettingsScopeContext + SettingsScopeIndicator; SettingsFieldRow now draws a per-row scope badge only when a row's scope differs from the screen's, so single-scope screens show exactly one badge. The default-workflow field's help moved onto a "?" on its header. Appearance was the only genuinely mixed screen and is split into `appearance` (global theme/language) and a new `appearance-project` section (task-presentation toggles), each single-scope; the new section is registered in the reset key registry and the settings search index.
