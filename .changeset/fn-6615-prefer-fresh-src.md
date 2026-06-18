---
"@runfusion/fusion": patch
---

Prefer fresher TypeScript plugin source over stale gitignored dist output in dev/worktree plugin resolution when no `bundled.js` exists. Production bundled installs remain unaffected because `bundled.js` still always wins.
