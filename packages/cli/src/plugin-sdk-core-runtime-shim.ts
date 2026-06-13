import type { BoardActionTaskStore, ColumnId, Task } from "@fusion/core";

export const WORKFLOW_EXTENSION_SCHEMA_VERSION = 1 as const;

export function workflowExtensionRegistryId(pluginId: string, extensionId: string): string {
  return `plugin:${pluginId}:${extensionId}`;
}

export interface MoveBoardTaskInput {
  taskId: string;
  column: ColumnId;
  preserveProgress?: boolean;
  source?: "user" | "engine" | "scheduler";
}

export interface UpdateBoardTaskInput {
  taskId: string;
  updates: Record<string, unknown>;
}

export function createBoardActionServices(store: BoardActionTaskStore) {
  return {
    moveTask(input: MoveBoardTaskInput): Promise<Task> {
      return store.moveTask(input.taskId, input.column, {
        preserveProgress: input.preserveProgress,
        moveSource: input.source ?? "user",
      });
    },
    updateTask(input: UpdateBoardTaskInput): Promise<Task> {
      return store.updateTask(input.taskId, input.updates);
    },
  };
}
