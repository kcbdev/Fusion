---
"@runfusion/fusion": minor
---

Add shared branch-group completion-gate promotion machinery so grouped shared branches promote to the default branch exactly once after all members land. This includes idempotent promotion re-evaluation, finalized branch-group status/PR tracking persistence, and lifecycle wiring that keeps member integration and shared→default promotion as separate phases.
