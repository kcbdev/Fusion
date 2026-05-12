import { TaskStore } from "@fusion/core";
import { resolveProject } from "../project-context.js";

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

async function resolveStore(projectName?: string): Promise<TaskStore> {
  try {
    return (await resolveProject(projectName)).store;
  } catch {
    const store = new TaskStore(process.cwd());
    await store.init();
    return store;
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
  let db: VacuumDatabase;
  let result: VacuumResult;

  try {
    const store = await resolveStore(projectName);
    db = store.getDatabase() as unknown as VacuumDatabase;

    if (typeof db.vacuum === "function") {
      result = await db.vacuum();
    } else {
      const start = Date.now();
      db.exec?.("VACUUM");
      result = { beforeSize: 0, afterSize: 0, durationMs: Date.now() - start };
    }
  } catch (error) {
    console.error(`Database VACUUM failed: ${(error as Error).message}`);
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
  process.exit(0);
}
