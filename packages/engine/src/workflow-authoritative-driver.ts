import {
  BUILTIN_CODING_WORKFLOW_IR,
  WORKFLOW_INTERPRETER_AUTHORITATIVE_FLAG,
  evaluateInterpreterCutoverReadiness,
  isExperimentalFeatureEnabled,
  type Settings,
  type Task,
  type TaskDetail,
  type WorkflowDefinition,
  type WorkflowParitySummary,
} from "@fusion/core";

import type { TaskExecutor } from "./executor.js";
import { executorLog } from "./logger.js";
import { WORKFLOW_INTERPRETER_DUAL_OBSERVE_FLAG } from "./workflow-parity-observer.js";
import { WorkflowGraphTaskRunner, type WorkflowGraphTaskRunResult } from "./workflow-graph-task-runner.js";

const AUTHORITATIVE_WORKFLOW_ID = "builtin:workflow-interpreter-authoritative";

export interface WorkflowAuthoritativeDriverStore {
  getSettings(): Promise<Settings>;
  getTask(taskId: string): Promise<TaskDetail>;
  getTaskWorkflowSelection?(taskId: string): { workflowId: string; stepIds: string[] } | undefined;
  getWorkflowParitySummary?(options?: { since?: string; limit?: number }): WorkflowParitySummary;
}

export interface WorkflowAuthoritativeDriverDeps {
  store: WorkflowAuthoritativeDriverStore;
  executor: Pick<TaskExecutor, "createAuthoritativeWorkflowSeams">;
  minimumObservedRuns?: number;
}

export interface WorkflowAuthoritativeDriverResult {
  handled: boolean;
  disposition: "completed" | "failed" | "fell-back";
  reason?: string;
  readinessReasons: string[];
  graphResult?: WorkflowGraphTaskRunResult;
}

function buildAuthoritativeSettings(settings: Settings): Settings {
  return {
    ...settings,
    experimentalFeatures: {
      ...(settings.experimentalFeatures ?? {}),
      workflowGraphExecutor: true,
      [WORKFLOW_INTERPRETER_AUTHORITATIVE_FLAG]: true,
    },
  };
}

export class WorkflowAuthoritativeDriver {
  public constructor(private readonly deps: WorkflowAuthoritativeDriverDeps) {}

  public async maybeRun(task: Task): Promise<WorkflowAuthoritativeDriverResult> {
    let settings: Settings;
    let paritySummary: WorkflowParitySummary | undefined;
    try {
      settings = await this.deps.store.getSettings();
      paritySummary = this.deps.store.getWorkflowParitySummary?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      executorLog.warn(`[workflow-authoritative] ${task.id}: readiness probe failed — falling back to legacy (${message})`);
      return {
        handled: false,
        disposition: "fell-back",
        reason: `store-unavailable: ${message}`,
        readinessReasons: ["workflow parity readiness probe unavailable"],
      };
    }
    const authoritativeFlagEnabled = isExperimentalFeatureEnabled(
      settings,
      WORKFLOW_INTERPRETER_AUTHORITATIVE_FLAG,
    );
    const dualObserveEnabled = isExperimentalFeatureEnabled(
      settings,
      WORKFLOW_INTERPRETER_DUAL_OBSERVE_FLAG,
    );
    const readiness = evaluateInterpreterCutoverReadiness({
      authoritativeFlagEnabled,
      dualObserveEnabled,
      paritySummary,
      minimumObservedRuns: this.deps.minimumObservedRuns,
    });
    if (!readiness.ready) {
      return {
        handled: false,
        disposition: "fell-back",
        reason: readiness.reasons.join("; "),
        readinessReasons: readiness.reasons,
      };
    }

    const existingSelection = this.deps.store.getTaskWorkflowSelection?.(task.id);
    if (existingSelection) {
      return {
        handled: false,
        disposition: "fell-back",
        reason: `workflow selection already present (${existingSelection.workflowId})`,
        readinessReasons: [],
      };
    }

    let liveTask: TaskDetail;
    try {
      liveTask = await this.deps.store.getTask(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      executorLog.warn(`[workflow-authoritative] ${task.id}: failed to load live task — falling back to legacy (${message})`);
      return {
        handled: false,
        disposition: "fell-back",
        reason: `task-load-failed: ${message}`,
        readinessReasons: [],
      };
    }
    const runner = new WorkflowGraphTaskRunner({
      store: {
        getTaskWorkflowSelection: () => ({ workflowId: AUTHORITATIVE_WORKFLOW_ID, stepIds: [] }),
        getWorkflowDefinition: async () => ({
          id: AUTHORITATIVE_WORKFLOW_ID,
          name: "Workflow interpreter authoritative cutover",
          ir: BUILTIN_CODING_WORKFLOW_IR,
        } satisfies Pick<WorkflowDefinition, "id" | "name" | "ir"> as WorkflowDefinition),
      },
      seams: this.deps.executor.createAuthoritativeWorkflowSeams(settings),
      runCustomNode: async (node) => {
        throw new Error(`unexpected custom node in builtin authoritative workflow: ${node.id}`);
      },
      onEvent: (event) => {
        executorLog.log(`[workflow-authoritative] ${event.type} ${event.taskId}: ${event.detail}`);
      },
    });

    const graphResult = await runner.run(liveTask, buildAuthoritativeSettings(settings));
    if (graphResult.disposition === "fell-back") {
      return {
        handled: false,
        disposition: "fell-back",
        reason: graphResult.reason,
        readinessReasons: [],
        graphResult,
      };
    }

    return {
      handled: true,
      disposition: graphResult.disposition,
      reason: graphResult.reason,
      readinessReasons: [],
      graphResult,
    };
  }
}
