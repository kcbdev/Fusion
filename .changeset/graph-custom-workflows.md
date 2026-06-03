---
"@runfusion/fusion": minor
---

Add executable custom workflows with a visual graph node editor. Author a workflow as a graph (start → prompt/script/gate steps → end) in a new React Flow–based editor, then select it per task or set a project default. Selected workflows compile to the existing WorkflowStep engine and run at the pre/post-merge boundaries — no changes to the scheduler/executor/merger. Non-linear graphs are rejected with a clear message and reserved for the (deferred) graph interpreter.
