import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = resolve(__dirname, "..");

function readCommand(command: "serve" | "daemon" | "dashboard"): string {
  return readFileSync(resolve(commandsDir, `${command}.ts`), "utf8");
}

/*
 * FNXC:GrokCliRouting 2026-07-09-23:05:
 * FN-7761 regression guard for packaged host bootstrap. The Grok helper must run before loadAllPlugins() in each long-lived CLI host so the enabled bundled runtime is loaded and getRuntimeById("grok") can resolve before chat/executor sessions try to route grok-cli/no-key messages.
 */
describe("Grok CLI runtime packaged bootstrap", () => {
  for (const command of ["serve", "daemon", "dashboard"] as const) {
    it(`${command} eagerly ensures the bundled Grok runtime before loading enabled plugins`, () => {
      const source = readCommand(command);
      const importIndex = source.indexOf("ensureBundledGrokRuntimePluginInstalled");
      const ensureIndex = source.indexOf("ensureBundledGrokRuntimePluginInstalled(pluginStore, pluginLoader)");
      const loadIndex = source.indexOf("pluginLoader.loadAllPlugins()");

      expect(importIndex).toBeGreaterThanOrEqual(0);
      expect(ensureIndex).toBeGreaterThanOrEqual(0);
      expect(loadIndex).toBeGreaterThanOrEqual(0);
      expect(ensureIndex).toBeLessThan(loadIndex);
    });
  }
});

/*
FNXC:GrokCliRouting 2026-07-15-09:58:
CLI/UI-only merge doors must thread pluginRunner into runAiMerge/landWorkspaceTask when a real PluginRunner is obtainable (engine warm). Bare `fn task merge` has no ProjectEngine — explicitly passes undefined rather than inventing a bootstrap.
*/
describe("Grok CLI PluginRunner wiring for CLI/UI-only merge doors", () => {
  it("dashboard onMergeImpl passes mergePluginRunner into runAiMerge and landWorkspaceTask", () => {
    const source = readCommand("dashboard");
    expect(source).toContain("let mergePluginRunner: PluginRunner | undefined");
    expect(source).toContain("mergePluginRunner =");
    expect(source).toContain("cwdEngine?.getPluginRunner?.()");

    const onMergeImplIndex = source.indexOf("const onMergeImpl = async (taskId: string)");
    expect(onMergeImplIndex).toBeGreaterThanOrEqual(0);
    const landCall = source.indexOf("landWorkspaceTask(store, mergeTask!, cwd, {", onMergeImplIndex);
    const runAiMergeCall = source.indexOf("runAiMerge(store, cwd, taskId, {", onMergeImplIndex);
    expect(landCall).toBeGreaterThan(onMergeImplIndex);
    expect(runAiMergeCall).toBeGreaterThan(onMergeImplIndex);
    expect(source.slice(landCall, landCall + 200)).toContain("pluginRunner");
    expect(source.slice(runAiMergeCall, runAiMergeCall + 250)).toContain("pluginRunner");
  });

  it("fn task merge threads pluginRunner option (undefined without a live ProjectEngine)", () => {
    const source = readFileSync(resolve(commandsDir, "task.ts"), "utf8");
    const mergeFnIndex = source.indexOf("export async function runTaskMerge");
    expect(mergeFnIndex).toBeGreaterThanOrEqual(0);
    const mergeFnBody = source.slice(mergeFnIndex, source.indexOf("export async function runTaskAttach", mergeFnIndex));
    expect(mergeFnBody).toContain("pluginRunner: mergePluginRunner");
    expect(mergeFnBody).toContain("FNXC:GrokCliRouting 2026-07-15-09:58");
    expect(mergeFnBody).toContain("const mergePluginRunner = undefined");
  });
});
