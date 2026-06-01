---
"@runfusion/fusion": minor
---

Add a safe onboarding auto-launch hook in the CLI bootstrap path. When the central DB is missing, interactive TTY commands now trigger `fn onboard` automatically before command dispatch, while non-interactive contexts (non-TTY, `serve`, `daemon`, explicit skip signals) remain unchanged and never block execution.
