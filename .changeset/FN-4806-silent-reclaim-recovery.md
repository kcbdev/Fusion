---
"@runfusion/fusion": patch
---

fix(FN-4806): silently recover when worktree/branch reclaimed mid-retry

When the executor's no-`fn_task_done` retry loop detects that a task's worktree or branch was reclaimed by an engine-side housekeeping path (FN-4546 stale-active-branch reclaim, FN-4742 self-healing removals, session-start unusable-worktree), it now requeues the task to `todo` silently with preserved progress. The task is no longer marked `failed`, `taskDoneRetryCount` is no longer burned, and `onError` is no longer surfaced — this is engine self-heal, not an agent failure. The genuine "agent finished without calling fn_task_done after N retries" exhaustion path is unchanged.
