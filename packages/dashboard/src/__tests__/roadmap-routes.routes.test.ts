// @vitest-environment node

import { describe, it, expect } from "vitest";
import express from "express";
import { registerIntegratedRouters } from "../routes/register-integrated-routers.js";

describe("integrated roadmap routes removed", () => {
  it("does not register a legacy /roadmaps mount", () => {
    const router = express.Router();
    registerIntegratedRouters({
      router,
      store: {} as never,
    });

    const mountedPaths = (router as unknown as { stack?: Array<{ regexp?: { source?: string } }> }).stack
      ?.map((layer) => layer.regexp?.source ?? "")
      ?? [];

    expect(mountedPaths.some((path) => path.includes("roadmaps"))).toBe(false);
  });
});
