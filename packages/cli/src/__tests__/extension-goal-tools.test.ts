import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import kbExtension from "../extension.js";

interface RegisteredTool {
  name: string;
  description: string;
  parameters?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: ((update: any) => void) | undefined,
    ctx: any,
  ) => Promise<any>;
}

function createMockAPI() {
  const tools = new Map<string, RegisteredTool>();

  const api = {
    registerTool(def: RegisteredTool) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    on() {},
    tools,
  };

  return api as any;
}

function makeCtx(cwd: string) {
  return { cwd } as any;
}

describe("extension goal retrieval tools", () => {
  let tmpDir: string;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-goal-tools-"));
    await mkdir(join(tmpDir, ".fusion"), { recursive: true });
    api = createMockAPI();
    kbExtension(api);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("registers fn_goal_show with expected schema", () => {
    const tool = api.tools.get("fn_goal_show");

    expect(tool).toBeDefined();
    expect(tool?.name).toBe("fn_goal_show");
    expect(tool?.description).toBe("Show full details for a single goal by ID.");
    expect(tool?.parameters).toMatchObject({
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "string",
          description: "Goal ID (G-…)",
        },
      },
    });
  });

  it("returns goal details with stable details.goal payload", async () => {
    const createTool = api.tools.get("fn_goal_create");
    const tool = api.tools.get("fn_goal_show");
    expect(createTool).toBeDefined();
    expect(tool).toBeDefined();

    const created = await createTool!.execute(
      "goal-create-1",
      { title: "Improve reliability", description: "Reduce flaky test retries" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    const goalId = created.details.goalId as string;
    const result = await tool!.execute("goal-show-1", { id: goalId }, undefined, undefined, makeCtx(tmpDir));

    expect(result.isError).toBeUndefined();
    expect(result.details.goal).toMatchObject({
      id: goalId,
      title: "Improve reliability",
      description: "Reduce flaky test retries",
      status: "active",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(result.content[0].text).toContain(goalId);
    expect(result.content[0].text).toContain("Improve reliability");
    expect(result.content[0].text).toContain("Status: active");
    expect(result.content[0].text).toContain("Created:");
    expect(result.content[0].text).toContain("Updated:");
  });

  it("returns GOAL_NOT_FOUND error for unknown id", async () => {
    const tool = api.tools.get("fn_goal_show");
    expect(tool).toBeDefined();

    const result = await tool!.execute("goal-show-404", { id: "G-404" }, undefined, undefined, makeCtx(tmpDir));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Goal G-404 not found");
    expect(result.details).toEqual({ code: "GOAL_NOT_FOUND", goalId: "G-404" });
  });

  it("supports list to show retrieval with stable json shape", async () => {
    const createTool = api.tools.get("fn_goal_create");
    const listTool = api.tools.get("fn_goal_list");
    const showTool = api.tools.get("fn_goal_show");
    expect(createTool).toBeDefined();
    expect(listTool).toBeDefined();
    expect(showTool).toBeDefined();

    await createTool!.execute("goal-create-2", { title: "Ship slice 2" }, undefined, undefined, makeCtx(tmpDir));

    const listResult = await listTool!.execute("goal-list-1", { status: "active" }, undefined, undefined, makeCtx(tmpDir));
    expect(Array.isArray(listResult.details.goals)).toBe(true);
    expect(listResult.details.goals.length).toBeGreaterThan(0);

    const listedGoal = listResult.details.goals[0] as { id: string };
    const showResult = await showTool!.execute("goal-show-2", { id: listedGoal.id }, undefined, undefined, makeCtx(tmpDir));

    expect(showResult.details.goal.id).toBe(listedGoal.id);
    expect(showResult.details.goal).toMatchObject({
      id: listedGoal.id,
      title: expect.any(String),
      status: "active",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
