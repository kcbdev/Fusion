import { describe, expect, it } from "vitest";
import {
  decideExecutionPlan,
  resolveAffectedPackages,
  shouldForceFullSuite,
} from "../../../../scripts/test-changed.mjs";

describe("root test command changed-only planning", () => {
  it("uses changed mode when package-only changes are detected", () => {
    const packageMap = new Map([
      ["core", "@fusion/core"],
      ["engine", "@fusion/engine"],
    ]);

    const plan = decideExecutionPlan({
      forceFullSuite: false,
      comparisonBase: "abc123",
      changedFiles: ["packages/core/src/store.ts", "packages/engine/src/index.ts"],
      packageNameByDir: packageMap,
    });

    expect(plan).toEqual({ mode: "changed", packages: ["@fusion/core", "@fusion/engine"] });
  });

  it("falls back to full suite when shared test infra changes", () => {
    const plan = decideExecutionPlan({
      forceFullSuite: false,
      comparisonBase: "abc123",
      changedFiles: ["scripts/test-with-lock.mjs"],
      packageNameByDir: new Map([["core", "@fusion/core"]]),
    });

    expect(plan).toEqual({ mode: "full", reason: "shared-infra-changed" });
  });

  it("falls back to full suite when comparison base cannot be resolved", () => {
    const plan = decideExecutionPlan({
      forceFullSuite: false,
      comparisonBase: null,
      changedFiles: null,
      packageNameByDir: new Map(),
    });

    expect(plan).toEqual({ mode: "full", reason: "missing-comparison-base" });
  });

  it("treats unknown package directories as full-suite fallback", () => {
    const resolved = resolveAffectedPackages(["packages/unknown/src/index.ts"], new Map());
    expect(resolved).toBeNull();
  });

  it("marks root workflow/config changes as full-suite triggers", () => {
    expect(shouldForceFullSuite([".github/workflows/ci.yml"])).toBe(true);
    expect(shouldForceFullSuite(["package.json"])).toBe(true);
    expect(shouldForceFullSuite(["packages/core/src/store.ts"])).toBe(false);
  });
});
