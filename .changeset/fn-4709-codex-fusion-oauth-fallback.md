---
"@runfusion/fusion": patch
---

Codex usage panel now falls back to the Fusion-stored `openai-codex` OAuth credential (`~/.fusion/agent/auth.json`) when the Codex CLI `auth.json` is missing, so Fusion OAuth users no longer see a spurious "run codex to login" error.
