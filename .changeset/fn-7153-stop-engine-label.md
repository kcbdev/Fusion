---
"@runfusion/fusion": patch
---

summary: Project Dashboard cards now say "Stop engine"/"Start engine" instead of "Pause"/"Resume".
category: feature
dev: Relabels ProjectCard pause/resume controls; pauseProject already stops the engine, so behavior is unchanged. i18n projectCard.* keys updated (en) with empty-string fallback for other locales.
