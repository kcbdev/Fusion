import { describe, expect, it } from "vitest";

import { BubblewrapBackend } from "../bubblewrap-backend.js";
import { NativeSandboxBackend } from "../native.js";
import { resolveSandboxBackend } from "../index.js";

describe("resolveSandboxBackend", () => {
  it("returns native for undefined backend", () => {
    expect(resolveSandboxBackend()).toBeInstanceOf(NativeSandboxBackend);
  });

  it("returns native for explicit native backend", () => {
    expect(resolveSandboxBackend({ backendId: "native" })).toBeInstanceOf(NativeSandboxBackend);
  });

  it("returns bubblewrap on linux when requested", () => {
    const backend = resolveSandboxBackend({ backendId: "bubblewrap" });
    if (process.platform === "linux") {
      expect(backend).toBeInstanceOf(BubblewrapBackend);
      return;
    }
    expect(backend).toBeInstanceOf(NativeSandboxBackend);
  });

  it("returns sandbox-exec on darwin when requested", async () => {
    const { SandboxExecBackend } = await import("../sandbox-exec-backend.js");
    const backend = resolveSandboxBackend({ backendId: "sandbox-exec" });
    if (process.platform === "darwin") {
      expect(backend).toBeInstanceOf(SandboxExecBackend);
      return;
    }
    expect(backend).toBeInstanceOf(NativeSandboxBackend);
  });
});
