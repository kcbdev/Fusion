---
"@runfusion/fusion": patch
---

Chat rooms now intelligently compact older messages into a summary header
when transcripts exceed the verbatim window, preserving long-running
context for agent replies instead of silently dropping earlier turns.
