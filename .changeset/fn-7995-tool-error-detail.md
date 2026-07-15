---
"@runfusion/fusion": patch
---

summary: Show the underlying error message for failed tool calls in the task Activity feed.
category: fix
dev: tool_error agent-log entries now always persist bounded `detail` regardless of `persistAgentToolOutput`; TaskChatTab renders it in an expandable "Error" block.
