import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { PlanningQuestion } from "@fusion/core";
import {
  TaskQuestionView,
  type TaskQuestionTransport,
  type TaskPendingQuestionState,
  type AnswerRejection,
} from "../TaskQuestionView";

const SINGLE: PlanningQuestion = {
  id: "q-single",
  type: "single_select",
  question: "Which framework?",
  options: [
    { id: "react", label: "React" },
    { id: "vue", label: "Vue", description: "progressive" },
  ],
};

const MULTI: PlanningQuestion = {
  id: "q-multi",
  type: "multi_select",
  question: "Which targets?",
  options: [
    { id: "ios", label: "iOS" },
    { id: "android", label: "Android" },
    { id: "web", label: "Web" },
  ],
};

const TEXT: PlanningQuestion = { id: "q-text", type: "text", question: "Describe the goal" };

const CONFIRM: PlanningQuestion = { id: "q-confirm", type: "confirm", question: "Ship it now?" };

function pending(question: PlanningQuestion, generation = "gen-1"): TaskPendingQuestionState {
  return { pending: true, sessionId: "s1", generation, stageId: "plan", question };
}

function makeTransport(initial: TaskPendingQuestionState): {
  transport: TaskQuestionTransport;
  answer: ReturnType<typeof vi.fn>;
  getPending: ReturnType<typeof vi.fn>;
} {
  const getPending = vi.fn(async () => initial);
  const answer = vi.fn(async () => undefined);
  return { transport: { getPending, answer }, answer, getPending };
}

describe("TaskQuestionView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there is no pending question", async () => {
    const { transport } = makeTransport({ pending: false });
    const { container } = render(<TaskQuestionView taskId="T-1" transport={transport} />);
    await waitFor(() => expect(transport.getPending).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="task-question-view"]')).toBeNull();
  });

  it("never renders for an LFG task and never fetches", () => {
    const { transport, getPending } = makeTransport(pending(TEXT));
    const { container } = render(<TaskQuestionView taskId="T-1" lfg transport={transport} />);
    expect(container.firstChild).toBeNull();
    expect(getPending).not.toHaveBeenCalled();
  });

  it("renders a single-select question and submits the selected option", async () => {
    const initial = pending(SINGLE);
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    expect(await screen.findByTestId("task-question-single")).toBeTruthy();
    fireEvent.click(screen.getByText("React").closest("label")!.querySelector("input")!);
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("T-1", { questionId: "q-single", response: "react", generation: "gen-1" }),
    );
  });

  it("renders a multi-select question and submits the chosen ids", async () => {
    const initial = pending(MULTI);
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    const multi = await screen.findByTestId("task-question-multi");
    fireEvent.click(multi.querySelector('input[data-option="ios"]')!);
    fireEvent.click(multi.querySelector('input[data-option="web"]')!);
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    // The response value carries the selected ids (steering empty → bare value).
    const call = answer.mock.calls[0][1] as { questionId: string; response: unknown };
    expect(call.questionId).toBe("q-multi");
    expect(call.response).toEqual(["ios", "web"]);
  });

  it("renders a free-text question and submits the typed answer", async () => {
    const initial = pending(TEXT);
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    const input = await screen.findByTestId("task-question-text-input");
    fireEvent.change(input, { target: { value: "  make it fast  " } });
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("T-1", { questionId: "q-text", response: "make it fast", generation: "gen-1" }),
    );
  });

  it("renders a confirm question and submits a boolean", async () => {
    const initial = pending(CONFIRM);
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    const group = await screen.findByTestId("task-question-confirm");
    fireEvent.click(group.querySelector('[data-confirm="yes"]')!);
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("T-1", { questionId: "q-confirm", response: true, generation: "gen-1" }),
    );
  });

  it("attaches steering text alongside a selected answer", async () => {
    const initial = pending(SINGLE);
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    await screen.findByTestId("task-question-single");
    fireEvent.click(screen.getByText("React").closest("label")!.querySelector("input")!);
    fireEvent.change(screen.getByTestId("task-question-steer-input"), {
      target: { value: "prefer the app router" },
    });
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    const call = answer.mock.calls[0][1] as { response: unknown };
    expect(call.response).toEqual({ value: "react", comment: "prefer the app router" });
  });

  it("clears gracefully and refuses to resubmit when the session is dead (409)", async () => {
    const initial = pending(TEXT);
    const getPending = vi.fn(async () => initial);
    const rejection: AnswerRejection = { status: 409, code: "session-detached", message: "moved" };
    const answer = vi.fn(async () => {
      throw rejection;
    });
    const onAnswered = vi.fn();
    render(
      <TaskQuestionView
        taskId="T-1"
        initial={initial}
        transport={{ getPending, answer }}
        onAnswered={onAnswered}
      />,
    );
    const input = await screen.findByTestId("task-question-text-input");
    fireEvent.change(input, { target: { value: "answer" } });
    fireEvent.click(screen.getByTestId("task-question-submit"));
    // The form clears to the closed message; the question form is gone.
    expect(await screen.findByTestId("task-question-closed")).toBeTruthy();
    expect(screen.queryByTestId("task-question-text-input")).toBeNull();
    expect(onAnswered).toHaveBeenCalled();
  });

  it("clears gracefully when the session has settled (410)", async () => {
    const initial = pending(CONFIRM);
    const getPending = vi.fn(async () => initial);
    const answer = vi.fn(async () => {
      throw { status: 410, code: "session-settled", message: "completed" } as AnswerRejection;
    });
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={{ getPending, answer }} />);
    const group = await screen.findByTestId("task-question-confirm");
    fireEvent.click(group.querySelector('[data-confirm="no"]')!);
    fireEvent.click(screen.getByTestId("task-question-submit"));
    expect(await screen.findByTestId("task-question-closed")).toBeTruthy();
  });

  it("updates live when a question arrives via the subscribe seam", async () => {
    // Starts with no pending question, then a CE event signals arrival → refetch.
    let current: TaskPendingQuestionState = { pending: false };
    const getPending = vi.fn(async () => current);
    const answer = vi.fn(async () => undefined);
    let fire: () => void = () => {};
    const subscribe = (_taskId: string, onEvent: () => void) => {
      fire = onEvent;
      return () => {};
    };
    render(<TaskQuestionView taskId="T-1" transport={{ getPending, answer }} subscribe={subscribe} />);
    await waitFor(() => expect(getPending).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("task-question-view")).toBeNull();

    // A question arrives; firing the subscribe callback triggers a refetch.
    current = pending(SINGLE, "gen-2");
    await act(async () => {
      fire();
    });
    expect(await screen.findByTestId("task-question-view")).toBeTruthy();
    expect(screen.getByTestId("task-question-single")).toBeTruthy();
  });

  it("uses the live generation token on submit (stale-question guard)", async () => {
    const initial = pending(TEXT, "gen-42");
    const { transport, answer } = makeTransport(initial);
    render(<TaskQuestionView taskId="T-1" initial={initial} transport={transport} />);
    fireEvent.change(await screen.findByTestId("task-question-text-input"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("task-question-submit"));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    expect((answer.mock.calls[0][1] as { generation?: string }).generation).toBe("gen-42");
  });
});
