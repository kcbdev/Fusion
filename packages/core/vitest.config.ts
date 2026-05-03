import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { computeMaxWorkers } from "./src/__test-utils__/vitest-workers";

const maxWorkers = computeMaxWorkers();

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/test-utils": resolve(__dirname, "./src/__test-utils__/workspace.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: [
      "./src/__tests__/setup-test-isolation.ts",
      "./src/__test-utils__/vitest-setup.ts",
    ],
    globalSetup: ["./src/__test-utils__/vitest-teardown.ts"],
    // Must stay "forks". Two thread-unsafe patterns block migration to "threads":
    //
    //   1. vitest-setup.ts:123 — `process.chdir(workerTempDir)` is gated by
    //      `isMainThread`, which is `false` in worker_threads, so each thread
    //      worker never gets its isolated cwd. Tests that rely on cwd being a
    //      disposable temp dir would silently operate in the repo root.
    //
    //   2. setup-test-isolation.ts:15-16 — `process.env.HOME` is written
    //      unconditionally in every setupFile invocation. Threads share
    //      `process.env`, so concurrent workers race on HOME and the last writer
    //      wins, breaking isolation for all other workers in the same run.
    pool: "forks",
    maxWorkers,
    poolOptions: { forks: { minForks: 1, maxForks: maxWorkers } },
    fileParallelism: true,
    // Core runs a large SQLite-heavy suite while other workspace packages test concurrently.
    // Use a slightly higher timeout to reduce nondeterministic slow-machine flakes.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      enabled: false,
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "dist/**"],
    },
  },
});
