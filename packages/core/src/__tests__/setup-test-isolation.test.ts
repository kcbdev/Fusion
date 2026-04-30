import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { execSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "../db.js";

const TEMP_HOME_PREFIX = "fn-test-home-";

describe("test isolation setup", () => {
  it("process.env.HOME is overridden to a temp directory", () => {
    const home = process.env.HOME;
    const userProfile = process.env.USERPROFILE;

    expect(home).toBeDefined();
    expect(home).toContain(tmpdir());
    expect(home).toContain(TEMP_HOME_PREFIX);
    expect(userProfile).toBe(home);
  });

  it("homedir() resolves to the temp HOME", () => {
    const home = homedir();

    expect(home).toContain(tmpdir());
    expect(home).toContain(TEMP_HOME_PREFIX);
  });

  it("defaultGlobalDir() resolves under the temp HOME", async () => {
    const { defaultGlobalDir } = await import("../global-settings.js");
    const dir = defaultGlobalDir();

    expect(dir).toContain(tmpdir());
    expect(dir).toMatch(/fn-test-home-.*[\\/]\.fusion$/);
  });

  it("GlobalSettingsStore() without explicit dir throws under VITEST guard", async () => {
    const { GlobalSettingsStore } = await import("../global-settings.js");

    expect(() => new GlobalSettingsStore()).toThrow(
      "resolveGlobalDir() called without explicit dir during test execution. Pass a temp directory to avoid writing to real ~/.fusion/",
    );
  });

  it("cwd is not inside the repository .fusion directory", () => {
    const thisFile = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(thisFile), "../../../../");
    const repoFusionDir = join(repoRoot, ".fusion");

    expect(process.cwd().startsWith(repoFusionDir)).toBe(false);
  });

  it("blocks sync filesystem writes into the repository .fusion directory", () => {
    const thisFile = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(thisFile), "../../../../");
    const blockedPath = join(repoRoot, ".fusion", "__vitest-guard-sync__");

    expect(() => mkdirSync(blockedPath, { recursive: true })).toThrow(
      "targeted protected repo .fusion directory",
    );
    expect(() => writeFileSync(join(repoRoot, ".fusion", "__vitest-guard-sync__.txt"), "x")).toThrow(
      "targeted protected repo .fusion directory",
    );
  });

  it("blocks async filesystem writes into the repository .fusion directory", async () => {
    const thisFile = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(thisFile), "../../../../");

    await expect(
      fsPromises.mkdir(join(repoRoot, ".fusion", "__vitest-guard-async__"), { recursive: true }),
    ).rejects.toThrow("targeted protected repo .fusion directory");
    await expect(
      fsPromises.writeFile(join(repoRoot, ".fusion", "__vitest-guard-async__.txt"), "x"),
    ).rejects.toThrow("targeted protected repo .fusion directory");
  });

  it("blocks SQLite opens against the repository fusion database", () => {
    const thisFile = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(thisFile), "../../../../");

    expect(() => new Database(join(repoRoot, ".fusion"))).toThrow(
      "targeted protected repo .fusion directory",
    );
  });

  it("blocks real AI CLI subprocesses from running in tests", () => {
    expect(() => spawnSync("droid", ["--version"])).toThrow(
      "Real AI CLI launch blocked during tests",
    );
    expect(() => execSync("claude --version", { encoding: "utf-8" })).toThrow(
      "Real AI CLI launch blocked during tests",
    );
  });

  it("still allows bounded local subprocesses", () => {
    const result = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
