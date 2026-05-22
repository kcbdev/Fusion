import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { ApiRequestError, api } from "../api";
import { useFileBrowser } from "../context/FileBrowserContext";
import "./StashConflictModal.css";

interface ResolveResponse {
  remainingConflicts: string[];
}

interface DropResponse {
  dropped: boolean;
}

interface RestoreResponse {
  applied: boolean;
  conflict: boolean;
  conflictedFiles: string[];
}

export interface StashConflictModalProps {
  open: boolean;
  onClose: () => void;
  worktreePath: string;
  integrationBranch: string;
  stashSha: string;
  stashLabel: string;
  conflictedFiles: string[];
  taskId?: string;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message || "Request failed";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Request failed";
}

export default function StashConflictModal({
  open,
  onClose,
  worktreePath,
  integrationBranch,
  stashSha,
  stashLabel,
  conflictedFiles,
  taskId,
}: StashConflictModalProps) {
  const fileBrowser = useFileBrowser();
  const [remainingConflicts, setRemainingConflicts] = useState<string[]>(conflictedFiles);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (open) {
      setRemainingConflicts(conflictedFiles);
      setError(null);
      setCopyState("idle");
    }
  }, [conflictedFiles, open]);

  const stashDescriptor = useMemo(() => `Stash ref: ${shortSha(stashSha)} (${stashLabel})`, [stashLabel, stashSha]);

  if (!open) {
    return null;
  }

  const resolveFile = async (file: string, choice: "ours" | "theirs") => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api<ResolveResponse>("/git/stash-resolve", {
        method: "POST",
        body: JSON.stringify({ worktreePath, stashSha, file, choice, taskId }),
      });
      setRemainingConflicts(Array.isArray(response.remainingConflicts) ? response.remainingConflicts : []);
    } catch (resolveError: unknown) {
      setError(getErrorMessage(resolveError));
    } finally {
      setSubmitting(false);
    }
  };

  const dropStash = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api<DropResponse>("/git/stash-drop", {
        method: "POST",
        body: JSON.stringify({ worktreePath, stashSha, taskId }),
      });
      if (response.dropped) {
        onClose();
      }
    } catch (dropError: unknown) {
      setError(getErrorMessage(dropError));
    } finally {
      setSubmitting(false);
    }
  };

  const restoreStash = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api<RestoreResponse>("/git/stash-restore", {
        method: "POST",
        body: JSON.stringify({ worktreePath, stashSha, taskId }),
      });
      if (response.conflict) {
        setRemainingConflicts(Array.isArray(response.conflictedFiles) ? response.conflictedFiles : []);
      }
    } catch (restoreError: unknown) {
      setError(getErrorMessage(restoreError));
    } finally {
      setSubmitting(false);
    }
  };

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(stashSha);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true" aria-label="Resolve stash conflicts">
      <div className="modal stash-conflict-modal">
        <div className="modal-header">
          <h3>Resolve auto-stash conflicts</h3>
        </div>
        <p className="stash-conflict-modal__summary">
          Pulled <strong>{integrationBranch}</strong>, but restoring local edits from stash produced conflicts.
        </p>
        <div className="stash-conflict-modal__stash-row">
          <span>{stashDescriptor}</span>
          <button type="button" className="btn btn-sm btn-icon" onClick={copyRef} aria-label="Copy stash reference">
            <Copy aria-hidden="true" />
          </button>
        </div>
        {copyState === "copied" ? <p className="stash-conflict-modal__hint">Stash SHA copied.</p> : null}
        {copyState === "failed" ? <p className="stash-conflict-modal__error">Could not copy stash SHA.</p> : null}
        <div className="stash-conflict-modal__list" role="list">
          {remainingConflicts.map((file) => (
            <div key={file} className="stash-conflict-row" role="listitem">
              <code className="stash-conflict-row__path">{file}</code>
              <div className="stash-conflict-row__actions">
                <button type="button" className="btn btn-sm" disabled={submitting} onClick={() => void resolveFile(file, "ours")}>
                  Keep mine
                </button>
                <button type="button" className="btn btn-sm" disabled={submitting} onClick={() => void resolveFile(file, "theirs")}>
                  Keep incoming
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={submitting}
                  onClick={() => fileBrowser?.openFile(file, { workspace: worktreePath })}
                >
                  Open in editor
                </button>
              </div>
            </div>
          ))}
        </div>
        {error ? <p className="stash-conflict-modal__error">{error}</p> : null}
        <div className="modal-actions">
          <div className="modal-actions-left">
            <button type="button" className="btn" disabled={submitting} onClick={() => void restoreStash()}>
              Restore from stash ref
            </button>
          </div>
          <div className="modal-actions-right">
            <button type="button" className="btn" disabled={submitting} onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-warning" disabled={submitting || remainingConflicts.length > 0} onClick={() => void dropStash()}>
              Drop stash
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
