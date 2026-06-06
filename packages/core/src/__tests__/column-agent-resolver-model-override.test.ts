import { describe, expect, it } from "vitest";
import {
  resolveEffectiveAgent,
  resolveCompanyExecutionAgentId,
} from "../column-agent-resolver.js";
import { COMPANY_BOARD_TEMPLATE_IR } from "../company-board-template.js";

const binding = { agentId: "agent-exec", mode: "defer" as const };

describe("per-task model override keeps the column agent (R7)", () => {
  it("legacy defer: a complete model pair suppresses the column agent (unchanged)", () => {
    expect(
      resolveEffectiveAgent({ binding, ownModelProvider: "anthropic", ownModelId: "claude-opus-4-8" }),
    ).toEqual({ source: "own-settings" });
  });

  it("company defer: a complete model pair does NOT suppress — same agent, custom model", () => {
    expect(
      resolveEffectiveAgent({
        binding,
        ownModelProvider: "anthropic",
        ownModelId: "claude-opus-4-8",
        modelPairSuppressesDefer: false,
      }),
    ).toEqual({ source: "column-agent", agentId: "agent-exec" });
  });

  it("company defer: an explicit own agent identity still suppresses", () => {
    expect(
      resolveEffectiveAgent({
        binding,
        ownAgentId: "agent-custom",
        modelPairSuppressesDefer: false,
      }),
    ).toEqual({ source: "own-settings" });
  });

  it("resolveCompanyExecutionAgentId keeps the column agent under a model pair", () => {
    const ir = structuredClone(COMPANY_BOARD_TEMPLATE_IR);
    const col = ir.columns.find((c) => c.id === "in-progress");
    if (col) col.agent = { agentId: "agent-exec", mode: "defer" };
    expect(
      resolveCompanyExecutionAgentId(ir, "in-progress", {
        ownModelProvider: "anthropic",
        ownModelId: "claude-opus-4-8",
      }),
    ).toBe("agent-exec");
  });
});
