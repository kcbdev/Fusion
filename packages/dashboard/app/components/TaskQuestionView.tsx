import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanningQuestion } from "@fusion/core";
import "./TaskQuestionView.css";

/**
 * Structured Q&A surface for awaiting-input column engines (U14, R21/R10).
 *
 * When a CE board column engine (e.g. the Lead's ce-plan stage) parks awaiting
 * human input, its session carries a structured {@link PlanningQuestion}. This
 * component renders that question as a structured form — single-select (radio),
 * multi-select (checkboxes), confirm (yes/no), or free text — mirroring the
 * planning / mission interview UI. An answer (plus optional steering text)
 * resumes the session and clears the awaiting-input state.
 *
 * The component is BOARD-FIRST and lives inside the task detail. It is fully
 * decoupled from the network via an injectable {@link TaskQuestionTransport}: the
 * default transport drives the CE plugin's task-scoped pending-question routes;
 * tests inject a deterministic fake. Liveness (a question arriving / a session
 * settling while the view is open) is driven by an injectable `subscribe` seam
 * (SSE in production, a no-op in tests) plus an interval-free refetch on signal.
 */

const CE_PLUGIN_ID = "fusion-plugin-compound-engineering";
const BASE = `/api/plugins/${CE_PLUGIN_ID}`;

/** The pending-question payload the route returns. */
export interface TaskPendingQuestionState {
  pending: boolean;
  sessionId?: string;
  generation?: string;
  stageId?: string;
  question?: PlanningQuestion;
}

/** A typed answer-route failure the client must handle (dead/settled/moved). */
export interface AnswerRejection {
  status: number;
  code?: string;
  message: string;
}

export interface TaskQuestionTransport {
  /** Fetch the task's current pending question (or `{ pending: false }`). */
  getPending(taskId: string): Promise<TaskPendingQuestionState>;
  /**
   * Submit an answer. Resolves on success. Rejects with an {@link AnswerRejection}
   * when the session is dead/settled/moved (409/410) so the view can clear
   * gracefully rather than silently failing.
   */
  answer(
    taskId: string,
    input: { questionId: string; response: unknown; generation?: string },
  ): Promise<void>;
}

async function parseError(res: Response): Promise<AnswerRejection> {
  let code: string | undefined;
  let message = `${res.status} ${res.statusText}`;
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    if (data.code) code = data.code;
    if (data.error) message = data.error;
  } catch {
    // keep the status-line fallback
  }
  return { status: res.status, code, message };
}

/** Default transport over the CE plugin's task-scoped routes. */
export const defaultTaskQuestionTransport: TaskQuestionTransport = {
  async getPending(taskId: string): Promise<TaskPendingQuestionState> {
    try {
      const res = await fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/pending-question`);
      if (!res.ok) {
        // A failed read should not crash the view; treat as "no pending question".
        return { pending: false };
      }
      return (await res.json()) as TaskPendingQuestionState;
    } catch {
      // Network/environment failure (offline, jsdom) — same fallback: no question.
      return { pending: false };
    }
  },
  async answer(taskId, input): Promise<void> {
    const res = await fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/answer-question`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw await parseError(res);
    }
  },
};

/** Subscribe to live CE session events for a task; returns an unsubscribe fn. */
export type TaskQuestionSubscribe = (taskId: string, onEvent: () => void) => () => void;
const noopSubscribe: TaskQuestionSubscribe = () => () => {};

export interface TaskQuestionViewProps {
  taskId: string;
  /** When true, the task is on an LFG board/posture — awaiting-input never
   *  applies (the server never persists it). The view renders nothing. */
  lfg?: boolean;
  transport?: TaskQuestionTransport;
  subscribe?: TaskQuestionSubscribe;
  /** Called after an answer resolves so the host can refetch the task/board. */
  onAnswered?: () => void;
  /** Initial state (for tests / server-prefetch). */
  initial?: TaskPendingQuestionState;
}

type CoerceResult = { value: unknown } | { value: undefined };

/**
 * The structured Q&A view. Renders the live pending question as a form and
 * answers it. Handles live arrival/settling (subscribe → refetch) and dead-
 * session refusal (typed rejection → clear with a message).
 */
export function TaskQuestionView(props: TaskQuestionViewProps) {
  const { t } = useTranslation("app");
  const transport = props.transport ?? defaultTaskQuestionTransport;
  const subscribe = props.subscribe ?? noopSubscribe;

  const [state, setState] = useState<TaskPendingQuestionState>(
    props.initial ?? { pending: false },
  );
  const [submitting, setSubmitting] = useState(false);
  const [deadMessage, setDeadMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  // Per-question form state.
  const [selected, setSelected] = useState<unknown>(undefined);
  const [steerText, setSteerText] = useState("");

  const question = state.pending ? state.question : undefined;
  const questionId = question?.id;

  const refetch = useCallback(async () => {
    if (props.lfg) return; // LFG never parks awaiting-input.
    const next = await transport.getPending(props.taskId);
    if (!mounted.current) return;
    setState(next);
    // A live arrival clears any prior dead-session message.
    if (next.pending) setDeadMessage(null);
  }, [props.lfg, props.taskId, transport]);

  // Initial load + subscribe for live updates (arrival, settle).
  useEffect(() => {
    mounted.current = true;
    if (props.lfg) {
      setState({ pending: false });
      return () => {
        mounted.current = false;
      };
    }
    if (!props.initial) void refetch();
    const unsubscribe = subscribe(props.taskId, () => {
      void refetch();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
    // Deliberately keyed on taskId/lfg only: refetch/subscribe are stable per render
    // of those inputs, and re-subscribing on every callback identity churn would
    // tear down the live SSE stream needlessly.
  }, [props.taskId, props.lfg]);

  // Reset the form when the live question identity changes.
  useEffect(() => {
    setSelected(undefined);
    setSteerText("");
  }, [questionId]);

  const coerceResponse = useCallback((): CoerceResult => {
    if (!question) return { value: undefined };
    switch (question.type) {
      case "text":
        return { value: typeof selected === "string" ? selected.trim() : "" };
      case "single_select":
        return { value: typeof selected === "string" ? selected : undefined };
      case "multi_select":
        return { value: Array.isArray(selected) ? selected : [] };
      case "confirm":
        return { value: typeof selected === "boolean" ? selected : undefined };
      default:
        return { value: undefined };
    }
  }, [question, selected]);

  const isValid = useMemo(() => {
    if (!question) return false;
    const r = coerceResponse().value;
    switch (question.type) {
      case "text":
        return typeof r === "string" && r.length > 0;
      case "single_select":
        return typeof r === "string" && r.length > 0;
      case "multi_select":
        return Array.isArray(r) && r.length > 0;
      case "confirm":
        return typeof r === "boolean";
      default:
        return false;
    }
  }, [question, coerceResponse]);

  const handleSubmit = useCallback(async () => {
    if (!question || !questionId || submitting || !isValid) return;
    const base = coerceResponse().value;
    const comment = steerText.trim();
    // Steering text rides along with the answer (the orchestrator's answer
    // payload carries `{ value, comment }`); for free text it is merged into the
    // answer body. This reaches the session as steering (R10).
    const response =
      comment.length > 0 && question.type !== "text"
        ? { value: base, comment }
        : comment.length > 0
          ? { value: base, comment }
          : base;
    setSubmitting(true);
    try {
      await transport.answer(props.taskId, {
        questionId,
        response,
        generation: state.generation,
      });
      if (!mounted.current) return;
      setState({ pending: false });
      setDeadMessage(null);
      props.onAnswered?.();
    } catch (err) {
      if (!mounted.current) return;
      const rejection = err as AnswerRejection;
      // 409/410 → the session is dead/settled/moved. Clear the form and show a
      // message; never leave a stuck spinner or resubmit into a corpse.
      if (rejection && (rejection.status === 409 || rejection.status === 410)) {
        setState({ pending: false });
        setDeadMessage(
          t(
            "tasks.questionSessionClosed",
            "This question can no longer be answered — the session has moved on. The board has been refreshed.",
          ),
        );
        props.onAnswered?.();
      } else {
        setDeadMessage(
          rejection?.message ??
            t("tasks.questionSubmitFailed", "Failed to submit your answer. Please try again."),
        );
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [question, questionId, submitting, isValid, coerceResponse, steerText, transport, props, state.generation, t]);

  if (props.lfg) return null;

  if (deadMessage && !state.pending) {
    return (
      <div className="task-question-view task-question-view--closed" data-testid="task-question-closed">
        <p className="task-question-closed-msg" role="status">
          {deadMessage}
        </p>
      </div>
    );
  }

  if (!state.pending || !question) {
    return null;
  }

  return (
    <div
      className="task-question-view"
      data-testid="task-question-view"
      data-stage={state.stageId}
      data-qtype={question.type}
    >
      <header className="task-question-header">
        <span className="task-question-badge">{t("tasks.needsInput", "Needs input")}</span>
        {state.stageId ? <span className="task-question-stage">{state.stageId}</span> : null}
      </header>

      <h4 className="task-question-text">{question.question}</h4>
      {question.description ? <p className="task-question-desc">{question.description}</p> : null}

      <div className="task-question-options">
        {question.type === "text" && (
          <textarea
            className="task-question-textarea"
            data-testid="task-question-text-input"
            rows={4}
            aria-label={question.question}
            placeholder={t("tasks.typeAnswer", "Type your answer here…")}
            value={typeof selected === "string" ? selected : ""}
            disabled={submitting}
            onChange={(e) => setSelected(e.target.value)}
          />
        )}

        {question.type === "single_select" && question.options && (
          <div className="task-question-radio-group" role="radiogroup" data-testid="task-question-single">
            {question.options.map((option) => (
              <label key={option.id} className="task-question-option task-question-option--radio">
                <input
                  type="radio"
                  name={question.id}
                  value={option.id}
                  data-option={option.id}
                  checked={selected === option.id}
                  disabled={submitting}
                  onChange={() => setSelected(option.id)}
                />
                <span className="task-question-option-content">
                  <span className="task-question-option-label">{option.label}</span>
                  {option.description ? (
                    <span className="task-question-option-desc">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        )}

        {question.type === "multi_select" && question.options && (
          <div className="task-question-checkbox-group" data-testid="task-question-multi">
            {question.options.map((option) => {
              const sel = Array.isArray(selected) ? (selected as string[]) : [];
              return (
                <label key={option.id} className="task-question-option task-question-option--checkbox">
                  <input
                    type="checkbox"
                    value={option.id}
                    data-option={option.id}
                    checked={sel.includes(option.id)}
                    disabled={submitting}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...sel, option.id]
                          : sel.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <span className="task-question-option-content">
                    <span className="task-question-option-label">{option.label}</span>
                    {option.description ? (
                      <span className="task-question-option-desc">{option.description}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {question.type === "confirm" && (
          <div className="task-question-confirm-group" data-testid="task-question-confirm">
            <button
              type="button"
              className={`task-question-confirm-btn${selected === true ? " selected" : ""}`}
              data-confirm="yes"
              disabled={submitting}
              onClick={() => setSelected(true)}
            >
              {t("actions.yes", "Yes")}
            </button>
            <button
              type="button"
              className={`task-question-confirm-btn${selected === false ? " selected" : ""}`}
              data-confirm="no"
              disabled={submitting}
              onClick={() => setSelected(false)}
            >
              {t("actions.no", "No")}
            </button>
          </div>
        )}
      </div>

      {question.type !== "text" && (
        <div className="task-question-steer">
          <label className="task-question-steer-label" htmlFor={`task-question-steer-${question.id}`}>
            {t("tasks.questionSteerLabel", "Add steering (optional — sent with your answer)")}
          </label>
          <textarea
            id={`task-question-steer-${question.id}`}
            className="task-question-textarea"
            data-testid="task-question-steer-input"
            rows={2}
            value={steerText}
            disabled={submitting}
            placeholder={t("tasks.questionSteerPlaceholder", "e.g. focus on the mobile flow, skip auth for now…")}
            onChange={(e) => setSteerText(e.target.value)}
          />
        </div>
      )}

      {deadMessage ? (
        <p className="task-question-error" role="alert" data-testid="task-question-error">
          {deadMessage}
        </p>
      ) : null}

      <div className="task-question-actions">
        <button
          type="button"
          className="btn btn-primary task-question-submit"
          data-testid="task-question-submit"
          disabled={!isValid || submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? t("tasks.questionSubmitting", "Sending…")
            : t("tasks.questionSubmit", "Submit answer")}
        </button>
      </div>
    </div>
  );
}
