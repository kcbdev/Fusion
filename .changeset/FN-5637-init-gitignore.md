---
"@runfusion/fusion": patch
---

feat(FN-5637): update `fn init` to add `fusion.db`, `fusion.db-wal`, and `fusion.db-shm` to project `.gitignore` alongside `.fusion` and `.pi` so stray runtime SQLite files are not committed.
