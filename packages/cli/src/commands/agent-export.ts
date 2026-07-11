/**
 * CLI command for exporting agents to Agent Companies packages.
 *
 * Usage:
 *   fn agent export <dir> [--company-name <name>] [--company-slug <slug>] [--project <name>]
 *
 * @module agent-export
 */

import { resolve } from "node:path";

import { AgentStore, exportAgentsToDirectory } from "@fusion/core";

import { resolveProjectPathOnly } from "../project-context.js";

/**
 * FNXC:CliAgentControl 2026-07-09-00:00:
 * FN-7740 audit finding: `getProjectPath` only ever needs the resolved
 * `projectPath` — it never uses `context.store`. The prior `resolveProject`
 * call still constructed (and, for registered/CWD-detected projects,
 * cached) a `TaskStore` that was never closed, leaking a SQLite/WAL handle
 * that keeps the CLI event loop alive after export finishes. Use
 * `resolveProjectPathOnly` (FN-7731/FN-7738), which closes+evicts the store
 * it constructs internally.
 */
async function getProjectPath(projectName?: string): Promise<string> {
  if (projectName) {
    return resolveProjectPathOnly(projectName);
  }

  try {
    return await resolveProjectPathOnly(undefined);
  } catch {
    return process.cwd();
  }
}

/**
 * FNXC:CliAgentControl 2026-07-09-00:00:
 * Mirrors `agent.ts`'s private `closeAgentStoreSafely` (FN-7704) — kept as
 * a tiny local copy here per FN-7740 File Scope (do NOT edit `agent.ts`,
 * and do NOT fork the `TaskStore` retry/teardown logic; this only closes
 * the `AgentStore` this file itself opens). Best-effort: an already-closed
 * store must never throw here.
 */
function closeAgentStoreSafely(agentStore: AgentStore): void {
  try {
    agentStore.close();
  } catch {
    // Best-effort teardown — never let a close failure block exit.
  }
}

function printSummary(result: {
  outputDir: string;
  agentsExported: number;
  skillsExported: number;
  filesWritten: string[];
  errors: Array<{ agentId: string; error: string }>;
}): void {
  console.log();
  console.log(`  Output directory: ${result.outputDir}`);
  console.log(`  Agents exported: ${result.agentsExported}`);
  console.log(`  Skills exported: ${result.skillsExported}`);
  console.log(`  Files written: ${result.filesWritten.length}`);

  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    for (const err of result.errors) {
      console.log(`    ✗ ${err.agentId}: ${err.error}`);
    }
  }

  console.log();
}

/**
 * Run the agent export command.
 */
export async function runAgentExport(
  outputDir: string,
  options?: {
    project?: string;
    companyName?: string;
    companySlug?: string;
    agentIds?: string[];
  },
): Promise<void> {
  const projectPath = await getProjectPath(options?.project);
  const agentStore = new AgentStore({ rootDir: projectPath + "/.fusion" });
  await agentStore.init();

  try {
    const allAgents = await agentStore.listAgents();
    const filterIds = options?.agentIds?.filter((id) => id.trim().length > 0);
    const agents = filterIds && filterIds.length > 0
      ? allAgents.filter((agent) => filterIds.includes(agent.id))
      : allAgents;

    if (agents.length === 0) {
      console.error("No agents found to export");
      closeAgentStoreSafely(agentStore);
      process.exit(1);
    }

    const result = await exportAgentsToDirectory(agents, resolve(outputDir), {
      companyName: options?.companyName,
      companySlug: options?.companySlug,
    });

    printSummary(result);
  } finally {
    closeAgentStoreSafely(agentStore);
  }
}
