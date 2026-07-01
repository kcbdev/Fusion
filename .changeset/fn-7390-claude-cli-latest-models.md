---
"@runfusion/fusion": patch
---

summary: Restore Claude Sonnet 5 and latest Anthropic models in the Claude CLI model picker.
category: fix
dev: pi-claude-cli supplemental extraModels now advertises claude-sonnet-5 for the subscription-authenticated CLI surface; direct-Anthropic supplemental registration and static pricing remain withheld per FN-7374's 404 not_found_error handling. Local evidence used claude 2.1.197 with --model accepting aliases/full names; checksum remains upstream-pending-verification.
