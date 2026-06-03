import type { Settings, TaskDetail, WorkflowDefinition } from "@fusion/core";
import { isExperimentalFeatureEnabled } from "@fusion/core";

import { WorkflowGraphExecutor, type WorkflowNodeOutcome } from "./workflow-graph-executor.js";
import type { WorkflowCustomNodeRunner, WorkflowLegacySeams } from "./workflow-node-handlers.js";

/**
 * Terminal disposition of an interpreter-driven task run.
 * - "completed"  — the graph ran to its end node successfully.
 * - "failed"     — the graph ran and terminated on a failure outcome.
 * - "fell-back"  — the interpreter did not (or could not) own this task;
 *                  the caller must run the legacy pipeline instead.
 */
export type WorkflowGraphRunDisposition = "completed" | "failed" | "fell-back";

export interface WorkflowGraphTaskRunResult {
  disposition: WorkflowGraphRunDisposition;
  outcome?: WorkflowNodeOutcome;
  visitedNodeIds: string[];
  /** Why the runner fell back (flag-off, no-selection, workflow-missing, interpreter-error). */
  reason?: string;
  /** Shared graph context after the run (node outcomes/values). */
  context?: Record<string, unknown>;
}

/** The minimal store surface the runner needs — keeps tests fake-friendly. */
export interface WorkflowGraphRunnerStore {
  getTaskWorkflowSelection(taskId: string): { workflowId: string; stepIds: string[] } | undefined;
  getWorkflowDefinition(id: string): Promise<WorkflowDefinition | undefined>;
}

export interface WorkflowGraphTaskRunnerDeps {
  store: WorkflowGraphRunnerStore;
  seams: WorkflowLegacySeams;
  runCustomNode: WorkflowCustomNodeRunner;
  maxRetriesPerNode?: number;
  /** Optional diagnostics hook (audit/log emission). Never throws into the run. */
  onEvent?: (event: { type: "start" | "terminal" | "fallback"; taskId: string; detail: string }) => void;
}

/**
 * Drives a task's lifecycle from its selected workflow graph. The runner owns
 * SEQUENCING only — seam nodes delegate to the legacy engine implementations
 * (execute/review/merge), custom nodes run via the injected runner. Any
 * interpreter-level error yields a "fell-back" disposition so the caller can
 * run the legacy pipeline; a task is never stranded by interpreter bugs.
 */
export class WorkflowGraphTaskRunner {
  public constructor(private readonly deps: WorkflowGraphTaskRunnerDeps) {}

  private emit(type: "start" | "terminal" | "fallback", taskId: string, detail: string): void {
    try {
      this.deps.onEvent?.({ type, taskId, detail });
    } catch {
      // Diagnostics must never affect the run.
    }
  }

  private fallBack(taskId: string, reason: string): WorkflowGraphTaskRunResult {
    this.emit("fallback", taskId, reason);
    return { disposition: "fell-back", reason, visitedNodeIds: [] };
  }

  public async run(
    task: TaskDetail,
    settings: Pick<Settings, "experimentalFeatures"> | undefined,
  ): Promise<WorkflowGraphTaskRunResult> {
    if (!isExperimentalFeatureEnabled(settings, "workflowGraphExecutor")) {
      return this.fallBack(task.id, "flag-off");
    }

    let selection: { workflowId: string; stepIds: string[] } | undefined;
    try {
      selection = this.deps.store.getTaskWorkflowSelection(task.id);
    } catch (err) {
      return this.fallBack(task.id, `selection-error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!selection) {
      return this.fallBack(task.id, "no-selection");
    }

    let definition: WorkflowDefinition | undefined;
    try {
      definition = await this.deps.store.getWorkflowDefinition(selection.workflowId);
    } catch (err) {
      return this.fallBack(task.id, `workflow-load-error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!definition) {
      return this.fallBack(task.id, `workflow-missing: ${selection.workflowId}`);
    }

    this.emit("start", task.id, definition.id);
    try {
      const executor = new WorkflowGraphExecutor({
        seams: this.deps.seams,
        runCustomNode: this.deps.runCustomNode,
        maxRetriesPerNode: this.deps.maxRetriesPerNode,
      });
      const result = await executor.run(task, settings, definition.ir);
      if (!result.executed) {
        return this.fallBack(task.id, "not-executed");
      }
      const disposition: WorkflowGraphRunDisposition = result.outcome === "success" ? "completed" : "failed";
      this.emit("terminal", task.id, `${definition.id}:${disposition}`);
      return {
        disposition,
        outcome: result.outcome,
        visitedNodeIds: result.visitedNodeIds,
        context: result.context,
      };
    } catch (err) {
      // Interpreter-level error (bad IR, handler wiring, etc.) — never strand
      // the task; the caller runs the legacy pipeline.
      return this.fallBack(task.id, `interpreter-error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
