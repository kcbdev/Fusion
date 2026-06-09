import { describe, expect, it } from "vitest";

import { nodeConfigSummary } from "../nodes/node-summary";
import type { WorkflowFlowNodeData } from "../nodes/WorkflowNodeTypes";

describe("nodeConfigSummary", () => {
  it("summarizes notify nodes by event", () => {
    const data: WorkflowFlowNodeData = {
      kind: "notify",
      label: "Notify",
      config: { event: "custom-event" },
    };

    expect(nodeConfigSummary(data)).toBe("custom-event");
  });

  it("includes a truncated notify message preview", () => {
    const data: WorkflowFlowNodeData = {
      kind: "notify",
      label: "Notify",
      config: {
        event: "workflow-notify",
        message: "This message is intentionally long enough that the summary should truncate it cleanly.",
      },
    };

    expect(nodeConfigSummary(data)).toBe("workflow-notify · This message is intentionally long enou…");
  });
});
