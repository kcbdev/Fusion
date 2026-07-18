---
"@runfusion/fusion": patch
---

summary: OAuth sign-ins (OpenAI Codex and others) now reliably open the system browser from the desktop app.
category: fix
dev: "window.open after the /auth/login await can outlive Chromium's transient user activation (~5s) and get silently popup-blocked on desktop — Codex's slower flow (method select + localhost callback server) hit this while Anthropic's usually didn't. New shell:openExternal IPC (http/https-validated) + preload openExternal + dashboard openExternalUrl helper used by all auth-URL opens, with window.open fallback on web."
