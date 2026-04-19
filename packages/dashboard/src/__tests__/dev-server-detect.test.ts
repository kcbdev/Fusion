// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectDevServerCandidates,
  EXCLUDED_SCRIPT_NAMES,
  invalidateDetectionCache,
  PREFERRED_SCRIPT_NAMES,
} from "../dev-server-detect.js";
import { FALLBACK_PORTS } from "../dev-server-manager.js";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("detectDevServerCandidates", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "fn-dev-detect-"));
    invalidateDetectionCache();
  });

  afterEach(() => {
    invalidateDetectionCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects preferred scripts from root package.json and excludes lint scripts", async () => {
    writeJson(path.join(tempDir, "package.json"), {
      scripts: {
        dev: "vite",
        start: "next dev",
        lint: "eslint .",
      },
    });

    const candidates = await detectDevServerCandidates(tempDir);

    expect(candidates.map((candidate) => candidate.scriptName)).toEqual(["dev", "start"]);
    expect(candidates[0]).toMatchObject({
      scriptName: "dev",
      label: "Root > dev",
      cwd: tempDir,
    });
    expect(candidates[1]).toMatchObject({
      scriptName: "start",
      label: "Root > start",
      cwd: tempDir,
    });
  });

  it("returns empty array when package.json is missing", async () => {
    await expect(detectDevServerCandidates(tempDir)).resolves.toEqual([]);
  });

  it("returns empty array when package.json has invalid json", async () => {
    writeFileSync(path.join(tempDir, "package.json"), "{ invalid json", "utf-8");
    await expect(detectDevServerCandidates(tempDir)).resolves.toEqual([]);
  });

  it("returns empty array when scripts field is absent", async () => {
    writeJson(path.join(tempDir, "package.json"), { name: "demo" });
    await expect(detectDevServerCandidates(tempDir)).resolves.toEqual([]);
  });

  it("detects workspace candidates from pnpm-workspace.yaml", async () => {
    writeJson(path.join(tempDir, "package.json"), { name: "repo" });
    writeFileSync(path.join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf-8");

    const workspaceDir = path.join(tempDir, "packages", "web");
    mkdirSync(workspaceDir, { recursive: true });
    writeJson(path.join(workspaceDir, "package.json"), {
      scripts: {
        dev: "vite",
      },
    });

    const candidates = await detectDevServerCandidates(tempDir);
    expect(candidates).toContainEqual(
      expect.objectContaining({
        scriptName: "dev",
        label: "packages/web > dev",
        cwd: workspaceDir,
      }),
    );
  });

  it("detects workspace candidates from npm workspaces array", async () => {
    writeJson(path.join(tempDir, "package.json"), {
      workspaces: ["apps/*"],
    });

    const clientDir = path.join(tempDir, "apps", "client");
    mkdirSync(clientDir, { recursive: true });
    writeJson(path.join(clientDir, "package.json"), {
      scripts: {
        dev: "vite",
      },
    });

    const candidates = await detectDevServerCandidates(tempDir);
    expect(candidates).toContainEqual(
      expect.objectContaining({
        scriptName: "dev",
        label: "apps/client > dev",
        cwd: clientDir,
      }),
    );
  });

  it("detects workspace candidates from npm workspaces object", async () => {
    writeJson(path.join(tempDir, "package.json"), {
      workspaces: {
        packages: ["apps/*"],
      },
    });

    const clientDir = path.join(tempDir, "apps", "client");
    mkdirSync(clientDir, { recursive: true });
    writeJson(path.join(clientDir, "package.json"), {
      scripts: {
        dev: "vite",
      },
    });

    const candidates = await detectDevServerCandidates(tempDir);
    expect(candidates).toContainEqual(
      expect.objectContaining({
        scriptName: "dev",
        label: "apps/client > dev",
        cwd: clientDir,
      }),
    );
  });

  it("orders candidates by preferred script priority", async () => {
    writeJson(path.join(tempDir, "package.json"), {
      scripts: {
        preview: "vite preview",
        storybook: "storybook dev -p 6006",
        frontend: "vite",
        web: "vite",
        serve: "vite serve",
        start: "next start",
        dev: "vite dev",
      },
    });

    const candidates = await detectDevServerCandidates(tempDir);
    expect(candidates.map((candidate) => candidate.scriptName)).toEqual([...PREFERRED_SCRIPT_NAMES]);
  });

  it("invalidates cache when package.json mtime changes", async () => {
    const packageJsonPath = path.join(tempDir, "package.json");
    writeJson(packageJsonPath, { scripts: { dev: "vite" } });

    const firstRun = await detectDevServerCandidates(tempDir);
    expect(firstRun.map((candidate) => candidate.scriptName)).toEqual(["dev"]);

    writeJson(packageJsonPath, { scripts: { start: "next dev" } });
    const now = new Date();
    utimesSync(packageJsonPath, now, new Date(now.getTime() + 5_000));

    const secondRun = await detectDevServerCandidates(tempDir);
    expect(secondRun.map((candidate) => candidate.scriptName)).toEqual(["start"]);
  });

  it("supports explicit cache invalidation", async () => {
    const packageJsonPath = path.join(tempDir, "package.json");
    writeJson(packageJsonPath, { scripts: { dev: "vite" } });

    await detectDevServerCandidates(tempDir);

    writeJson(packageJsonPath, { scripts: { serve: "vite" } });
    invalidateDetectionCache(tempDir);

    const refreshed = await detectDevServerCandidates(tempDir);
    expect(refreshed.map((candidate) => candidate.scriptName)).toEqual(["serve"]);
  });

  it("never includes reserved dashboard port 4040 in fallback ports", () => {
    expect(EXCLUDED_SCRIPT_NAMES.has("lint")).toBe(true);
    expect(FALLBACK_PORTS.includes(4040 as never)).toBe(false);
  });
});
