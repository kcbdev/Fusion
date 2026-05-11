---
"@runfusion/fusion": patch
---

Executor task runtime environment now flows through `createResolvedAgentSession()` and `createFnAgent()` into task-scoped agent subprocesses (including executor-session bash commands). Plugin-provided `executorRuntimeEnv` PATH/env contributions are available inside agent-issued subprocesses while remaining isolated per task/session with no global `process.env` mutation.
