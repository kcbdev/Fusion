---
"@runfusion/fusion": patch
---

summary: Fix slash/namespaced skill commands not loading in chat and agent sessions.
category: fix
dev: skill-resolver requested-name matching now reduces a/b, a/b/SKILL.md, and source::a/b forms to the bare token like the dashboard bareSkillName, scoped to requested-name matching (allow/exclude path matching unchanged).
