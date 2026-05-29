---
"@runfusion/fusion": patch
---

When `useAiMergeCommitSummary` is enabled, AI-authored merge commits now include a richer body: the short narrative headline plus an AI-generated bullet summary of changed modules/files, followed by a `Files changed` diff stat block.

`mergeDetails.mergeCommitMessage` remains the short headline summary so dashboard UI consumers keep their existing concise display behavior.
