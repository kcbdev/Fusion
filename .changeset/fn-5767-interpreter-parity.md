---
"@runfusion/fusion": minor
---

Add workflow graph interpreter node handlers and traversal semantics behind the default-off `workflowGraphExecutor` experimental flag. The interpreter now supports prompt/script/gate dispatch through legacy seam DI, edge-condition routing (`success`/`failure`/`outcome:<value>`), bounded retries, and parity-oriented tests for no-op flag behavior and lifecycle routing.
