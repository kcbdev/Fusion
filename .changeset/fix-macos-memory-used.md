---
"@runfusion/fusion": patch
---

Fix macOS system memory usage reporting by deriving host memory used from OS-available memory instead of raw `os.freemem()` pages.
