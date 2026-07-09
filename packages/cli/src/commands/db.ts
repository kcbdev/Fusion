import { TaskStore } from "@fusion/core";
import { resolveProject, closeProjectStore, asLocalProjectContext, type ProjectContext } from "../project-context.js";
import { retryOnLock, LockRetryExhaustedError } from "../lock-retry.js";

type VacuumResult = {
  beforeSize: number;
  afterSize: number;
  durationMs: number;
};

type VacuumDatabase = {
  vacuum?: () => Promise<VacuumResult> | VacuumResult;
  exec?: (sql: string) => void;
  getPath?: () => string;
};

/**
 * FNXC:CliBoardMutation 2026-07-09-00:00:
 * FN-7739 audit finding: `resolveStore` resolves a `TaskStore` (cached via
 * `resolveProject`, OR an UNCACHED `new TaskStore(process.cwd())`
 * CWD-fallback). Unlike `backup.ts`/`memory-backup.ts`/`mcp.ts`,
 * `runDbVacuum` already calls `process.exit(0/1)` on EVERY path, so there is
 * no event-loop hang leak today — but `process.exit()` does not run pending
 * `finally` blocks (see project memory), so the resolved store was never
 * explicitly closed either way, and a leaked-but-about-to-exit handle is
 * still untidy. VACUUM requires an EXCLUSIVE database lock — the canonical
 * transient-lock case this task targets (a concurrent engine/agent writer
 * momentarily holding the DB). Decision recorded in the FN-7739 audit task
 * document (key="audit"): wrap the VACUUM call in `retryOnLock` so it
 * succeeds once a momentary writer lock clears instead of failing outright
 * on one unlucky race, and close the resolved store (via
 * `closeProjectStore`/`asLocalProjectContext` for the uncached branch)
 * explicitly BEFORE each `process.exit()` call for tidy, deterministic
 * teardown. Reuses the FN-7731/FN-7738 helpers — no forked implementation.
 */
async function resolveStoreContext(projectName?: string): Promise<ProjectContext> {
  try {
    return await resolveProject(projectName);
  } catch {
    const store = new TaskStore(process.cwd());
    await store.init();
    return asLocalProjectContext(store);
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

export async function runDbVacuum(projectName?: string): Promise<void> {
  let context: ProjectContext | undefined;
  let db: VacuumDatabase;
  let result: VacuumResult;

  try {
    context = await resolveStoreContext(projectName);
    db = context.store.getDatabase() as unknown as VacuumDatabase;

    result = await retryOnLock(
      async () => {
        if (typeof db.vacuum === "function") {
          return await db.vacuum();
        }
        const start = Date.now();
        db.exec?.("VACUUM");
        return { beforeSize: 0, afterSize: 0, durationMs: Date.now() - start };
      },
      { id: "db-vacuum", action: "VACUUM database" },
    );
  } catch (error) {
    const message = error instanceof LockRetryExhaustedError
      ? error.message
      : `Database VACUUM failed: ${(error as Error).message}`;
    console.error(message);
    if (context) {
      await closeProjectStore(context);
    }
    process.exit(1);
    return;
  }

  const path = db.getPath?.() ?? "<unknown>";
  if (path === ":memory:") {
    console.log("VACUUM skipped for in-memory database.");
  } else {
    console.log(
      `VACUUM completed in ${result.durationMs}ms (${formatBytes(result.beforeSize)} -> ${formatBytes(result.afterSize)}): ${path}`,
    );
  }
  if (context) {
    await closeProjectStore(context);
  }
  process.exit(0);
}
