import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, ApiRequestError } from "../api";
import { subscribeSse } from "../sse-bus";
import StashConflictModal from "./StashConflictModal";
import "./MergeAdvanceNotice.css";

interface MergeAdvanceEvent {
  taskId: string;
  integrationBranch: string;
  refName: string;
  toSha: string;
  fromSha: string | null;
  advanceMode: "fast-forward" | "non-fast-forward" | "update-ref" | string;
  succeeded: boolean;
  advancedAt: string;
  userCheckout: {
    worktreePath: string;
    dirty: boolean;
    untrackedCount: number;
  } | null;
}

interface MergeAdvanceEventsResponse {
  events: MergeAdvanceEvent[];
}

type SmartPullResponse =
  | { kind: "clean-pull"; toSha: string }
  | { kind: "stash-pull-pop"; toSha: string }
  | { kind: "stash-pop-conflict"; toSha: string; stashSha: string; stashLabel: string; conflictedFiles: string[] };

interface MergeAdvanceNoticeProps {
  projectId?: string;
  apiBase?: string;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function dismissedStorageKey(projectId?: string): string {
  return `kb:merge-advance-notice-dismissed:${projectId ?? "default"}`;
}

function readDismissedShas(projectId?: string): string[] {
  try {
    const raw = window.localStorage.getItem(dismissedStorageKey(projectId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function persistDismissedShas(projectId: string | undefined, values: string[]): void {
  try {
    window.localStorage.setItem(dismissedStorageKey(projectId), JSON.stringify(values.slice(-50)));
  } catch {
    // ignore storage failures
  }
}

export default function MergeAdvanceNotice({ projectId, apiBase = "/api" }: MergeAdvanceNoticeProps) {
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [events, setEvents] = useState<MergeAdvanceEvent[]>([]);
  const [dismissedShas, setDismissedShas] = useState<string[]>(() => readDismissedShas(projectId));
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    stashSha: string;
    stashLabel: string;
    conflictedFiles: string[];
  } | null>(null);

  useEffect(() => {
    setDismissedShas(readDismissedShas(projectId));
  }, [projectId]);

  const fetchEvents = useCallback(async () => {
    try {
      const query = new URLSearchParams({ limit: "5" });
      if (projectId) {
        query.set("projectId", projectId);
      }
      const response = await api<MergeAdvanceEventsResponse>(`/tasks/merge-advance-events?${query.toString()}`);
      setEvents(Array.isArray(response.events) ? response.events : []);
    } catch {
      setEvents([]);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchEvents();
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const unsubscribe = subscribeSse(`${apiBase}/events${query}`, {
      events: {
        "task:merged": () => {
          void fetchEvents();
        },
      },
    });
    return () => {
      unsubscribe();
    };
  }, [apiBase, fetchEvents, projectId]);

  const notice = useMemo(() => events.find((event) => (
    event.succeeded === true
    && event.userCheckout !== null
    && event.userCheckout.worktreePath.trim().length > 0
  )), [events]);

  if (!notice || dismissedShas.includes(notice.toSha) || !notice.userCheckout) {
    return null;
  }

  const checkout = notice.userCheckout;
  const localChangesPreserved = checkout.dirty || checkout.untrackedCount > 0;

  const dismiss = () => {
    const next = [...dismissedShas.filter((sha) => sha !== notice.toSha), notice.toSha].slice(-50);
    setDismissedShas(next);
    persistDismissedShas(projectId, next);
  };

  const dismissWithFocusGuard = () => {
    const activeElement = document.activeElement;
    const focusedInsideBanner = activeElement instanceof HTMLElement && bannerRef.current?.contains(activeElement);
    dismiss();
    if (focusedInsideBanner) {
      document.body.focus();
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setPullError(null);
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const response = await api<SmartPullResponse>(`/git/smart-pull${query}`, {
        method: "POST",
        body: JSON.stringify({
          worktreePath: checkout.worktreePath,
          integrationBranch: notice.integrationBranch,
          taskId: notice.taskId,
        }),
      });
      if (response.kind === "stash-pop-conflict") {
        setConflictState({
          stashSha: response.stashSha,
          stashLabel: response.stashLabel,
          conflictedFiles: response.conflictedFiles,
        });
        return;
      }
      dismissWithFocusGuard();
    } catch (error: unknown) {
      if (error instanceof ApiRequestError) {
        setPullError(error.message || "Pull failed");
      } else if (error instanceof Error && error.message) {
        setPullError(error.message);
      } else {
        setPullError("Pull failed");
      }
    } finally {
      setPulling(false);
    }
  };

  return (
    <>
      <div ref={bannerRef} className="merge-advance-notice" role="status" aria-live="polite">
        <div className="merge-advance-notice__content">
          <strong>{notice.integrationBranch} advanced to {shortSha(notice.toSha)}.</strong>{" "}
          Your checked-out copy at {checkout.worktreePath} is behind.
          {localChangesPreserved ? " (local changes will be auto-stashed and restored)" : ""}
          {pullError ? <span className="merge-advance-notice__error" role="alert"> {pullError}</span> : null}
          {pulling ? <span className="merge-advance-notice__hint"> Pulling…</span> : null}
        </div>
        <div className="merge-advance-notice__actions">
          {conflictState ? null : (
            <button type="button" className="btn btn-sm" disabled={pulling} onClick={handlePull}>
              Pull
            </button>
          )}
          <button
            type="button"
            className="merge-advance-notice__dismiss touch-target"
            aria-label="Dismiss merge advance notice"
            onClick={dismissWithFocusGuard}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <StashConflictModal
        open={conflictState !== null}
        onClose={() => {
          setConflictState(null);
          dismissWithFocusGuard();
        }}
        worktreePath={checkout.worktreePath}
        integrationBranch={notice.integrationBranch}
        stashSha={conflictState?.stashSha ?? ""}
        stashLabel={conflictState?.stashLabel ?? ""}
        conflictedFiles={conflictState?.conflictedFiles ?? []}
        taskId={notice.taskId}
      />
    </>
  );
}
