/**
 * Planning Mode Session Management
 *
 * Manages AI-guided planning sessions for interactive task creation.
 * Sessions are stored in-memory with TTL cleanup.
 * 
 * NOTE: AI Agent integration is stubbed for now. When integrating with
 * the real AI agent, update createSession and submitResponse to use
 * createKbAgent from "@kb/engine".
 */

import type {
  PlanningQuestion,
  PlanningSummary,
  PlanningResponse,
  TaskStore,
} from "@kb/core";
import { createKbAgent } from "@kb/engine";
import { randomUUID } from "node:crypto";

// ── Constants ───────────────────────────────────────────────────────────────

/** Planning system prompt for the AI agent */
export const PLANNING_SYSTEM_PROMPT = `You are a planning assistant for the kb task board system.

Your job: help users transform vague, high-level ideas into well-defined, actionable tasks.

## Conversation Flow
1. User provides a high-level plan (e.g., "Build a user auth system")
2. You ask clarifying questions to understand scope, requirements, and constraints
3. You present UI-friendly selection options when appropriate
4. Once you have enough information, generate a structured summary

## Question Types to Use
- "text": Open-ended follow-up questions for detailed input
- "single_select": When user must choose one option (e.g., tech stack preference)
- "multi_select": When multiple options can apply (e.g., features to include)
- "confirm": Yes/No questions for quick decisions

## Guidelines
- Ask 3-7 questions depending on complexity
- Start broad, then narrow down specifics
- Suggest sensible defaults based on project context
- Keep questions focused and actionable
- When asking about file scope, reference actual project structure

## Summary Generation
When ready to complete, generate:
- A concise but descriptive title (max 80 chars)
- A detailed description with context gathered
- Size estimate (S/M/L) based on scope
- Any suggested dependencies on existing tasks
- Key deliverables as a checklist`;

/** Session TTL in milliseconds (30 minutes) */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Max planning sessions per IP per hour */
const MAX_SESSIONS_PER_IP_PER_HOUR = 5;

/** Rate limiting window in milliseconds (1 hour) */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  ip: string;
  initialPlan: string;
  history: Array<{ question: PlanningQuestion; response: unknown }>;
  currentQuestion?: PlanningQuestion;
  summary?: PlanningSummary;
  createdAt: Date;
  updatedAt: Date;
}

interface RateLimitEntry {
  count: number;
  firstRequestAt: Date;
}

// ── In-Memory Storage ───────────────────────────────────────────────────────

/** Active planning sessions indexed by session ID */
const sessions = new Map<string, Session>();

/** Rate limiting state indexed by IP */
const rateLimits = new Map<string, RateLimitEntry>();

// ── Cleanup Interval ────────────────────────────────────────────────────────

/**
 * Remove expired sessions and stale rate limit entries.
 * Runs periodically via setInterval.
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  let cleanedSessions = 0;
  let cleanedRateLimits = 0;

  // Clean up expired sessions
  for (const [id, session] of sessions) {
    if (now - session.updatedAt.getTime() > SESSION_TTL_MS) {
      sessions.delete(id);
      cleanedSessions++;
    }
  }

  // Clean up stale rate limit entries
  for (const [ip, entry] of rateLimits) {
    if (now - entry.firstRequestAt.getTime() > RATE_LIMIT_WINDOW_MS) {
      rateLimits.delete(ip);
      cleanedRateLimits++;
    }
  }

  if (cleanedSessions > 0 || cleanedRateLimits > 0) {
    console.log(
      `[planning] Cleanup: removed ${cleanedSessions} sessions, ${cleanedRateLimits} rate limit entries`
    );
  }
}

// Start cleanup interval
const cleanupInterval = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

// Handle graceful shutdown
process.on("beforeExit", () => {
  clearInterval(cleanupInterval);
});

// ── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Check if IP can create a new planning session.
 * Returns true if allowed, false if rate limited.
 */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry) {
    // First request from this IP
    rateLimits.set(ip, {
      count: 1,
      firstRequestAt: new Date(),
    });
    return true;
  }

  // Check if window has expired
  if (now - entry.firstRequestAt.getTime() > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    rateLimits.set(ip, {
      count: 1,
      firstRequestAt: new Date(),
    });
    return true;
  }

  // Within window - check limit
  if (entry.count >= MAX_SESSIONS_PER_IP_PER_HOUR) {
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

/**
 * Get rate limit reset time for an IP.
 * Returns null if no rate limit entry exists.
 */
export function getRateLimitResetTime(ip: string): Date | null {
  const entry = rateLimits.get(ip);
  if (!entry) return null;

  return new Date(entry.firstRequestAt.getTime() + RATE_LIMIT_WINDOW_MS);
}

// ── Planning Session Class ──────────────────────────────────────────────────

/**
 * PlanningSession class for managing AI-guided planning conversations.
 * 
 * This class encapsulates the planning session state and provides methods
 * for interacting with the AI agent to generate questions and summaries.
 */
export class PlanningSession {
  id: string;
  ip: string;
  initialPlan: string;
  history: Array<{ question: PlanningQuestion; response: unknown }>;
  currentQuestion?: PlanningQuestion;
  summary?: PlanningSummary;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent?: any;
  createdAt: Date;
  updatedAt: Date;

  constructor(initialPlan: string, ip: string) {
    this.id = randomUUID();
    this.ip = ip;
    this.initialPlan = initialPlan;
    this.history = [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Get the next question from the AI agent based on the initial plan.
   * Stubbed - will be replaced with AI agent integration.
   */
  async getNextQuestion(): Promise<PlanningQuestion | PlanningSummary> {
    if (this.history.length === 0) {
      return generateFirstQuestion(this.initialPlan);
    }
    return this.generateNextQuestionOrSummary();
  }

  /**
   * Submit a response and get the next question or summary.
   * Stubbed - will be replaced with AI agent integration.
   */
  async submitResponse(response: unknown): Promise<PlanningQuestion | PlanningSummary> {
    if (!this.currentQuestion) {
      throw new InvalidSessionStateError("No active question in session");
    }

    this.history.push({
      question: this.currentQuestion,
      response,
    });
    this.updatedAt = new Date();

    return this.generateNextQuestionOrSummary();
  }

  /**
   * Dispose of the session and cleanup resources.
   */
  dispose(): void {
    // Cleanup any resources if needed
  }

  /**
   * Generate next question or summary based on session history.
   * Stubbed - will be replaced with AI agent integration.
   */
  private generateNextQuestionOrSummary(): PlanningQuestion | PlanningSummary {
    const historyLength = this.history.length;

    if (historyLength < 2) {
      return {
        id: `q-${historyLength + 1}`,
        type: "text",
        question: "What are the key requirements or acceptance criteria?",
        description: "List the specific things that need to be true for this task to be considered complete.",
      };
    }

    if (historyLength < 3) {
      return {
        id: "q-confirm",
        type: "confirm",
        question: "Are there any specific technologies or libraries that should be used?",
        description: "Answer yes if you have preferences for specific tech stack choices.",
      };
    }

    return this.generateSummary();
  }

  /**
   * Generate a summary from session history.
   * Stubbed - will be replaced with AI agent integration.
   */
  private generateSummary(): PlanningSummary {
    const scopeResponse = this.history.find((h) => h.question.id === "q-scope")?.response as
      | { scope?: string }
      | undefined;

    const requirementsResponse = this.history.find((h) => h.question.type === "text")?.response as
      | { requirements?: string }
      | undefined;

    const suggestedSize =
      scopeResponse?.scope === "small" ? "S" : scopeResponse?.scope === "large" ? "L" : "M";

    return {
      title: this.initialPlan.slice(0, 80),
      description:
        `${this.initialPlan}\n\n` +
        `Requirements: ${requirementsResponse?.requirements || "Standard implementation"}\n\n` +
        `Generated via Planning Mode`,
      suggestedSize,
      suggestedDependencies: [],
      keyDeliverables: ["Implementation", "Tests", "Documentation"],
    };
  }
}

// ── Stubbed AI Integration (to be replaced with real AI agent) ──────────────

/**
 * Generate the first question based on the initial plan.
 * This is a stub - will be replaced with AI agent.
 */
function generateFirstQuestion(initialPlan: string): PlanningQuestion {
  // Simple stub: ask about scope
  return {
    id: "q-scope",
    type: "single_select",
    question: "What is the scope of this plan?",
    description: "This helps estimate the size and complexity of the task.",
    options: [
      { id: "small", label: "Small - focused change affecting 1-3 files", description: "Quick implementation" },
      { id: "medium", label: "Medium - moderate change affecting 3-10 files", description: "Standard feature" },
      { id: "large", label: "Large - significant change affecting 10+ files", description: "Complex feature or refactor" },
    ],
  };
}

/**
 * Generate next question or summary based on session history.
 * This is a stub - will be replaced with AI agent.
 */
function generateNextQuestionOrSummary(session: Session): PlanningResponse {
  const historyLength = session.history.length;

  // Simple stub: ask 2-3 questions then generate summary
  if (historyLength < 2) {
    return {
      type: "question",
      data: {
        id: `q-${historyLength + 1}`,
        type: "text",
        question: "What are the key requirements or acceptance criteria?",
        description: "List the specific things that need to be true for this task to be considered complete.",
      },
    };
  }

  if (historyLength < 3) {
    return {
      type: "question",
      data: {
        id: "q-confirm",
        type: "confirm",
        question: "Are there any specific technologies or libraries that should be used?",
        description: "Answer yes if you have preferences for specific tech stack choices.",
      },
    };
  }

  // Generate summary after 3 questions
  return {
    type: "complete",
    data: generateSummary(session),
  };
}

/**
 * Generate a summary from session history.
 * This is a stub - will be replaced with AI agent.
 */
function generateSummary(session: Session): PlanningSummary {
  // Simple stub: create summary from initial plan and history
  const scopeResponse = session.history.find((h) => h.question.id === "q-scope")?.response as
    | { scope?: string }
    | undefined;

  const requirementsResponse = session.history.find((h) => h.question.type === "text")?.response as
    | { requirements?: string }
    | undefined;

  const suggestedSize =
    scopeResponse?.scope === "small" ? "S" : scopeResponse?.scope === "large" ? "L" : "M";

  return {
    title: session.initialPlan.slice(0, 80),
    description:
      `${session.initialPlan}\n\n` +
      `Requirements: ${requirementsResponse?.requirements || "Standard implementation"}\n\n` +
      `Generated via Planning Mode`,
    suggestedSize,
    suggestedDependencies: [],
    keyDeliverables: ["Implementation", "Tests", "Documentation"],
  };
}

// ── Session Management ───────────────────────────────────────────────────────

/**
 * Create a new planning session.
 * Returns session ID and first question (stubbed for now - AI integration in future).
 */
export async function createSession(
  ip: string,
  initialPlan: string,
  _store?: TaskStore,
  _rootDir?: string
): Promise<{ sessionId: string; firstQuestion: PlanningQuestion }> {
  // Check rate limit
  if (!checkRateLimit(ip)) {
    const resetTime = getRateLimitResetTime(ip);
    throw new RateLimitError(
      `Rate limit exceeded. Maximum ${MAX_SESSIONS_PER_IP_PER_HOUR} planning sessions per hour. ` +
        `Reset at ${resetTime?.toISOString() || "unknown"}`
    );
  }

  const sessionId = randomUUID();

  // Generate first question based on initial plan (stub - AI will do this in future)
  const firstQuestion = generateFirstQuestion(initialPlan);

  const session: Session = {
    id: sessionId,
    ip,
    initialPlan,
    history: [],
    currentQuestion: firstQuestion,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  sessions.set(sessionId, session);

  return { sessionId, firstQuestion };
}

/**
 * Submit a response to the current question and get the next question or summary.
 * Stubbed - AI integration will be implemented in future.
 */
export async function submitResponse(
  sessionId: string,
  responses: Record<string, unknown>
): Promise<PlanningResponse> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(`Planning session ${sessionId} not found or expired`);
  }

  if (!session.currentQuestion) {
    throw new InvalidSessionStateError("No active question in session");
  }

  // Record the response
  session.history.push({
    question: session.currentQuestion,
    response: responses,
  });

  // Generate next question or summary (stub - AI will do this in future)
  const result = generateNextQuestionOrSummary(session);

  if (result.type === "question") {
    session.currentQuestion = result.data;
  } else {
    session.summary = result.data;
    session.currentQuestion = undefined;
  }

  session.updatedAt = new Date();

  return result;
}

/**
 * Cancel and cleanup a planning session.
 */
export async function cancelSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(`Planning session ${sessionId} not found or expired`);
  }

  sessions.delete(sessionId);
}

/**
 * Get session details.
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * Get the current question for a session.
 */
export function getCurrentQuestion(sessionId: string): PlanningQuestion | undefined {
  return sessions.get(sessionId)?.currentQuestion;
}

/**
 * Get the summary for a completed session.
 */
export function getSummary(sessionId: string): PlanningSummary | undefined {
  return sessions.get(sessionId)?.summary;
}

/**
 * Cleanup a session (used after task creation).
 */
export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Reset all planning state. Used for testing only.
 */
export function __resetPlanningState(): void {
  sessions.clear();
  rateLimits.clear();
}

// ── Custom Errors ───────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

export class InvalidSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionStateError";
  }
}
