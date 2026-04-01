---
"@gsxdsm/fusion": patch
---

Fix pre-existing test failures (KB-637)

- Fixed engine executor test missing mock for git worktree list command
- Fixed dashboard SettingsModal temporal dead zone issue with activeSectionScope variable
- Fixed dashboard routes tests by adding getMissionStore mock and using actual git repository for Git Management endpoints
