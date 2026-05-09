---
"@runfusion/fusion": patch
---

Triage: progressively compact large optional sections (subtask guidance, attachments, existing spec, user comments) of the spec prompt when the model's context window overflows, in addition to the existing project-memory compaction. Fixes failures on small-context models such as local vLLM Qwen3-30B (issue Runfusion/Fusion#62, FN-3877).
