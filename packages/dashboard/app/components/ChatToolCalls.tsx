import type { ReactNode } from "react";
import { Wrench } from "lucide-react";

export interface ChatToolCallInfo {
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: "running" | "completed";
  isError?: boolean;
}

interface ChatToolCallsProps {
  toolCalls?: ChatToolCallInfo[];
  compact?: boolean;
}

function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function formatToolArgsSummary(args?: Record<string, unknown>): string | null {
  if (!args) {
    return null;
  }

  const entries = Object.entries(args);
  if (entries.length === 0) return null;

  return entries
    .map(([key, value]) => {
      let stringValue = "";
      if (typeof value === "string") {
        stringValue = value;
      } else {
        try {
          stringValue = JSON.stringify(value);
        } catch {
          stringValue = String(value);
        }
      }
      return `${key}=${truncateValue(stringValue, 50)}`;
    })
    .join(", ");
}

function formatToolResultSummary(result: unknown): string | null {
  if (result === undefined) {
    return null;
  }

  if (typeof result === "string") {
    return truncateValue(result, 200);
  }

  try {
    return truncateValue(JSON.stringify(result), 200);
  } catch {
    return truncateValue(String(result), 200);
  }
}

function renderToolCallItem(toolCall: ChatToolCallInfo, index: number): ReactNode {
  const isRunning = toolCall.status === "running";
  const isError = toolCall.status === "completed" && toolCall.isError;
  const argsSummary = formatToolArgsSummary(toolCall.args);
  const resultSummary = formatToolResultSummary(toolCall.result);
  const summaryPreview = isRunning
    ? argsSummary
    : resultSummary
      ? `result: ${resultSummary}`
      : argsSummary
        ? `args: ${argsSummary}`
        : null;
  const statusLabel = isRunning ? "running" : isError ? "error" : "completed";

  return (
    <details
      key={`${toolCall.toolName}-${index}`}
      className={`chat-tool-call${isRunning ? " chat-tool-call--running" : ""}${isError ? " chat-tool-call--error" : ""}`}
      open={isRunning}
    >
      <summary>
        <span className="chat-tool-call-status-dot" aria-hidden="true" />
        <span className="chat-tool-call-name">{toolCall.toolName}</span>
        {summaryPreview && (
          <span className="chat-tool-call-preview" title={summaryPreview}>
            {summaryPreview}
          </span>
        )}
        <span className="chat-tool-call-status-text">{statusLabel}</span>
      </summary>
      <div className="chat-tool-call-content">
        {argsSummary && (
          <div className="chat-tool-call-row">
            <span className="chat-tool-call-label">args</span>
            <span className="chat-tool-call-value">{argsSummary}</span>
          </div>
        )}
        {resultSummary && (
          <div className={`chat-tool-call-row${isError ? " chat-tool-call-row--error" : ""}`}>
            <span className="chat-tool-call-label">result</span>
            <span className="chat-tool-call-value">{resultSummary}</span>
          </div>
        )}
      </div>
    </details>
  );
}

export function ChatToolCalls({ toolCalls, compact = false }: ChatToolCallsProps): ReactNode {
  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  const className = `chat-tool-calls${compact ? " chat-tool-calls--compact" : ""}`;

  if (toolCalls.length === 1) {
    return (
      <div className={className} data-testid="chat-tool-calls">
        <div className="chat-tool-calls-header">
          <Wrench size={12} aria-hidden="true" />
          <span>Tool calls</span>
        </div>
        {renderToolCallItem(toolCalls[0], 0)}
      </div>
    );
  }

  const completedCount = toolCalls.filter((toolCall) => toolCall.status === "completed" && !toolCall.isError).length;
  const runningCount = toolCalls.filter((toolCall) => toolCall.status === "running").length;
  const errorCount = toolCalls.filter((toolCall) => toolCall.status === "completed" && toolCall.isError).length;
  const hasRunning = runningCount > 0;

  return (
    <div className={className} data-testid="chat-tool-calls">
      <details className="chat-tool-calls-group" open={hasRunning}>
        <summary className="chat-tool-calls-group-summary">
          <div className="chat-tool-calls-header">
            <Wrench size={12} aria-hidden="true" />
            <span>{toolCalls.length} tool calls</span>
          </div>
          <span className="chat-tool-calls-group-status">
            {completedCount > 0 && <span className="chat-tool-calls-group-count">{completedCount} completed</span>}
            {runningCount > 0 && (
              <span className="chat-tool-calls-group-count chat-tool-calls-group-count--running">{runningCount} running</span>
            )}
            {errorCount > 0 && (
              <span className="chat-tool-calls-group-count chat-tool-calls-group-count--error">{errorCount} error</span>
            )}
          </span>
        </summary>
        <div className="chat-tool-calls-group-items">{toolCalls.map((toolCall, index) => renderToolCallItem(toolCall, index))}</div>
      </details>
    </div>
  );
}
