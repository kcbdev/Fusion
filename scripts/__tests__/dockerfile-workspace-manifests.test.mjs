import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function readWorkspacePackageManifestPaths() {
  const workspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
  const workspace = YAML.parse(readFileSync(workspacePath, "utf8"));
  const entries = Array.isArray(workspace?.packages) ? workspace.packages : [];
  const manifestPaths = new Set();

  for (const entry of entries) {
    if (entry === "packages/*") {
      const packageDirs = readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
      for (const dir of packageDirs) {
        const manifest = `packages/${dir}/package.json`;
        if (existsSync(path.join(repoRoot, manifest))) {
          manifestPaths.add(manifest);
        }
      }
      continue;
    }

    if (entry === "plugins/examples/*") {
      const exampleDirs = readdirSync(path.join(repoRoot, "plugins/examples"), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
      for (const dir of exampleDirs) {
        const manifest = `plugins/examples/${dir}/package.json`;
        if (existsSync(path.join(repoRoot, manifest))) {
          manifestPaths.add(manifest);
        }
      }
      continue;
    }

    const manifest = `${entry}/package.json`;
    if (existsSync(path.join(repoRoot, manifest))) {
      manifestPaths.add(manifest);
    }
  }

  return manifestPaths;
}

function readDockerfileCopiedManifestPaths() {
  const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  const copied = new Set();
  for (const match of dockerfile.matchAll(/^COPY\s+(\S+)\s+\.\/\S+$/gm)) {
    const source = match[1];
    if (source.endsWith("/package.json")) {
      copied.add(source);
    }
  }
  return { copied, dockerfile };
}

test("Dockerfile builder manifest copy list covers pnpm workspace package manifests", () => {
  const expected = readWorkspacePackageManifestPaths();
  const { copied } = readDockerfileCopiedManifestPaths();

  const missing = [...expected].filter((manifest) => !copied.has(manifest));
  assert.deepEqual(missing, []);
});

test("Dockerfile no longer references removed packages/tui package.json", () => {
  const { dockerfile } = readDockerfileCopiedManifestPaths();
  assert.ok(!dockerfile.includes("COPY packages/tui/package.json ./packages/tui/package.json"));
});
