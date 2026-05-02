---
"@runfusion/fusion": patch
---

Tokenize `isInProcessBackupCommand` so it accepts the full canonical zero-install form `npx -y runfusion.ai backup --create` (and other npx flag combinations such as `--yes`, `-p <pkg>`, `--package=<pkg>`) and refuses commands that embed shell continuations or redirections (`&&`, `||`, `|`, `;`, `>`, `<`, backticks, `$()`). The previous regex permitted only a bare `npx` prefix and silently swallowed any tail after `--create`, which meant `npx -y runfusion.ai backup --create` still hit the legacy shell-out and `fn backup --create && notify-send done` lost its trailing side effect when intercepted. The new matcher only intercepts when the entire command is a plain in-process backup invocation; anything else continues through the shell as authored.
