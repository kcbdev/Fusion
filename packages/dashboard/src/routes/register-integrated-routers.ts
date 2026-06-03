import type { Router } from "express";
import type { TaskStore } from "@fusion/core";
import type { ServerOptions } from "../server.js";
import { createMissionRouter } from "../mission-routes.js";
import { createInsightsRouter } from "../insights-routes.js";
import { createEvalsRouter } from "../evals-routes.js";
import { createResearchRouter } from "../research-routes.js";
import { createExperimentRouter } from "../experiment-routes.js";
import { createTodoRouter } from "../todo-routes.js";
import { createGoalsRouter } from "../goals-routes.js";
import { createRoadmapCompatibilityRouter } from "../roadmap-routes.js";
import { createDevServerRouter } from "../dev-server-routes.js";
import type { AiSessionStore } from "../ai-session-store.js";
import { createStashRecoveryRouter } from "./register-stash-recovery-routes.js";
import { createBranchGroupsRouter } from "./register-branch-groups-routes.js";
import { GitHubClient, closeGroupPullRequest } from "../github.js";

interface IntegratedRoutersOptions {
  router: Router;
  store: TaskStore;
  options?: ServerOptions;
  aiSessionStore?: AiSessionStore;
}

interface DevServerRouterOptions {
  router: Router;
  store: TaskStore;
}

export function registerIntegratedRouters({
  router,
  store,
  options,
  aiSessionStore,
}: IntegratedRoutersOptions): void {
  router.use(
    "/missions",
    createMissionRouter(store, options?.missionAutopilot, aiSessionStore, options?.missionExecutionLoop, options?.engineManager),
  );

  router.use("/insights", createInsightsRouter(store));
  router.use("/evals", createEvalsRouter(store));
  router.use("/research", createResearchRouter(store));
  router.use("/experiments", createExperimentRouter(store));
  router.use("/todos", createTodoRouter(store));
  router.use("/goals", createGoalsRouter(store));
  router.use("/roadmaps", createRoadmapCompatibilityRouter(store));
  router.use("/stash-recovery", createStashRecoveryRouter(store));
  router.use("/branch-groups", createBranchGroupsRouter(store, {
    promoteBranchGroup: async ({ groupId, projectId }) => {
      const engine = projectId && options?.engineManager
        ? options.engineManager.getEngine(projectId)
        : options?.engine;
      const promote = (engine as { promoteBranchGroup?: (id: string) => Promise<Record<string, unknown>> } | undefined)?.promoteBranchGroup;
      if (!promote) {
        throw new Error("promoteBranchGroup is not available on engine");
      }
      return await promote(groupId);
    },
    closeGroupPr: async ({ group }) => {
      // Best-effort terminal reconciliation: close the single managed GitHub PR
      // (U6, R7). The route still marks the row abandoned/closed if this returns
      // null or throws.
      if (group.prNumber == null) {
        return null;
      }
      const client = new GitHubClient();
      const result = await closeGroupPullRequest(client, group);
      return { prNumber: result.prNumber, prUrl: result.prUrl, prState: result.prState };
    },
  }));
}

export function registerIntegratedDevServerRouter({ router, store }: DevServerRouterOptions): void {
  const devServerRouter = createDevServerRouter({
    projectRoot: store.getRootDir(),
  });
  router.use("/dev-server", devServerRouter);
}
