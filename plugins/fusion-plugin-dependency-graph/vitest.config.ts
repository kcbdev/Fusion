import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { computeMaxWorkers } from "../../packages/core/src/__test-utils__/vitest-workers";

const maxWorkers = computeMaxWorkers();

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@fusion-plugin-examples\/dependency-graph\/dashboard-view$/,
        replacement: fileURLToPath(new URL("./src/dashboard-view.tsx", import.meta.url)),
      },
      {
        find: /^@fusion-plugin-examples\/dependency-graph$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
      { find: "@fusion/core", replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
      {
        find: "@fusion/plugin-sdk",
        replacement: fileURLToPath(new URL("../../packages/plugin-sdk/src/index.ts", import.meta.url)),
      },
      { find: "@fusion/dashboard", replacement: fileURLToPath(new URL("../../packages/dashboard", import.meta.url)) },
      {
        find: "lucide-react",
        replacement: fileURLToPath(new URL("../../packages/dashboard/node_modules/lucide-react", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("../../packages/core/src/__test-utils__/vitest-setup.ts", import.meta.url))],
    globalSetup: [fileURLToPath(new URL("../../packages/core/src/__test-utils__/vitest-teardown.ts", import.meta.url))],
    pool: "threads",
    maxWorkers,
    poolOptions: { threads: { minThreads: 1, maxThreads: maxWorkers }, forks: { minForks: 1, maxForks: maxWorkers } },
  },
});
