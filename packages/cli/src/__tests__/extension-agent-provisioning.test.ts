import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import kbExtension from "../extension.js";

function createMockAPI() {
  const tools = new Map<string, any>();
  return {
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    on() {},
    tools,
  } as any;
}

describe("extension agent provisioning tools", () => {
  it("creates and deletes agents as privileged user caller", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fn-ext-provision-"));
    try {
      const api = createMockAPI();
      kbExtension(api);
      const createTool = api.tools.get("fn_agent_create");
      const deleteTool = api.tools.get("fn_agent_delete");

      const name = `Provisioned-${Date.now()}`;
      const createResult = await createTool.execute("call-1", { name, role: "executor" }, undefined, undefined, { cwd });
      expect(createResult.details.outcome).toBe("created");
      const createdId = createResult.details.agentId as string;
      expect(createdId).toBeTruthy();

      const deleteResult = await deleteTool.execute("call-2", { agent_id: createdId }, undefined, undefined, { cwd });
      expect(deleteResult.details.outcome).toBe("deleted");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
