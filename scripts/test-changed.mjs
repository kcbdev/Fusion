#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = process.cwd();

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function gitOutput(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function getBaseBranch() {
  const changesetConfigPath = path.join(rootDir, ".changeset", "config.json");
  const changesetConfig = JSON.parse(readFileSync(changesetConfigPath, "utf8"));
  return changesetConfig.baseBranch || "main";
}

function listWorkspacePackages() {
  const packagesDir = path.join(rootDir, "packages");
  const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const packageNameByDir = new Map();
  for (const dir of packageDirs) {
    try {
      const packageJsonPath = path.join(packagesDir, dir, "package.json");
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof pkg.name === "string") {
        packageNameByDir.set(dir, pkg.name);
      }
    } catch {
      // ignore directories without package.json
    }
  }

  return packageNameByDir;
}

export function shouldForceFullSuite(changedFiles) {
  const fullSuitePaths = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".changeset/config.json",
    "vitest.workspace.ts",
    "eslint.config.mjs",
    "tsconfig.base.json",
    "scripts/test-with-lock.mjs",
    "scripts/test-changed.mjs",
  ];

  return changedFiles.some((file) => {
    if (fullSuitePaths.includes(file)) {
      return true;
    }

    if (file.startsWith(".github/workflows/") || file.startsWith("scripts/test-") || file.startsWith("scripts/check-test-")) {
      return true;
    }

    if (file.startsWith("packages/") && /vitest|test/.test(path.basename(file))) {
      return false;
    }

    if (!file.startsWith("packages/") && !file.startsWith("docs/")) {
      return true;
    }

    return false;
  });
}

function detectComparisonBase(baseBranch) {
  const candidates = [
    `origin/${baseBranch}`,
    `refs/remotes/origin/${baseBranch}`,
    baseBranch,
  ];

  for (const candidate of candidates) {
    const mergeBase = gitOutput(["merge-base", "HEAD", candidate]);
    if (mergeBase) {
      return mergeBase;
    }
  }

  return null;
}

function changedFilesSince(baseSha) {
  const diff = gitOutput(["diff", "--name-only", `${baseSha}...HEAD`]);
  if (diff === null) {
    return null;
  }
  if (!diff) {
    return [];
  }
  return diff.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

export function resolveAffectedPackages(changedFiles, packageNameByDir) {
  const affected = new Set();

  for (const file of changedFiles) {
    if (!file.startsWith("packages/")) {
      continue;
    }

    const [, dir] = file.split("/");
    const packageName = packageNameByDir.get(dir);
    if (!packageName) {
      return null;
    }
    affected.add(packageName);
  }

  return [...affected];
}

const fullSuiteEnv = {
  ...process.env,
  FUSION_TEST_TOTAL_WORKERS: process.env.FUSION_TEST_TOTAL_WORKERS || "4",
  FUSION_TEST_CONCURRENCY: process.env.FUSION_TEST_CONCURRENCY || "2",
};

function runFullSuite(forwardedArgs) {
  run("pnpm", ["-r", "--workspace-concurrency=2", "test", ...forwardedArgs], { env: fullSuiteEnv });
}

export function decideExecutionPlan({
  forceFullSuite,
  comparisonBase,
  changedFiles,
  packageNameByDir,
}) {
  if (forceFullSuite) return { mode: "full", reason: "forced" };
  if (!comparisonBase) return { mode: "full", reason: "missing-comparison-base" };
  if (!changedFiles) return { mode: "full", reason: "diff-failed" };
  if (changedFiles.length === 0) return { mode: "full", reason: "no-changes" };
  if (shouldForceFullSuite(changedFiles)) return { mode: "full", reason: "shared-infra-changed" };

  const affectedPackages = resolveAffectedPackages(changedFiles, packageNameByDir);
  if (!affectedPackages || affectedPackages.length === 0) return { mode: "full", reason: "no-affected-package" };

  return { mode: "changed", packages: affectedPackages };
}

export function main(argv = process.argv.slice(2)) {
  const forceFullSuite =
    process.env.CI === "true" ||
    process.env.FUSION_TEST_FULL === "1" ||
    argv.includes("--full");

  const forwardedArgs = argv.filter((arg) => arg !== "--full");

  run("pnpm", ["sync:fusion-skill:check"]);

  const baseBranch = getBaseBranch();
  const comparisonBase = detectComparisonBase(baseBranch);
  const changedFiles = comparisonBase ? changedFilesSince(comparisonBase) : null;
  const packageNameByDir = listWorkspacePackages();

  const plan = decideExecutionPlan({
    forceFullSuite,
    comparisonBase,
    changedFiles,
    packageNameByDir,
  });

  if (plan.mode === "full") {
    if (plan.reason === "missing-comparison-base") {
      console.log(`[test-changed] could not resolve merge-base with ${baseBranch}; running full suite.`);
    } else if (plan.reason === "diff-failed") {
      console.log("[test-changed] failed to read git diff; running full suite.");
    } else if (plan.reason === "no-changes") {
      console.log("[test-changed] no changes detected against base; running full suite.");
    } else if (plan.reason === "shared-infra-changed") {
      console.log("[test-changed] shared/root test infrastructure changed; running full suite.");
    } else if (plan.reason === "no-affected-package") {
      console.log("[test-changed] no affected workspace package resolved; running full suite.");
    }

    runFullSuite(forwardedArgs);
    return;
  }

  const filterArgs = plan.packages.flatMap((pkg) => ["--filter", pkg]);
  console.log(`[test-changed] running tests for changed packages: ${plan.packages.join(", ")}`);
  run("pnpm", [...filterArgs, "test", ...forwardedArgs], { env: fullSuiteEnv });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
