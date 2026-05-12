---
"@runfusion/fusion": patch
---

Improve SQLite write reliability under transient multi-connection lock contention by adding bounded recovery for outer write transactions, keeping task mutations and run-audit inserts atomic during executor-driven writes.
