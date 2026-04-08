import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Pencil, Save, X } from "lucide-react";
import type { NodeInfo, NodeUpdateInput, ProjectInfo } from "../api";
import type { ToastType } from "../hooks/useToast";

interface NodeDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: NodeInfo | null;
  projects: ProjectInfo[];
  onUpdate: (id: string, updates: NodeUpdateInput) => Promise<void>;
  onHealthCheck: (id: string) => Promise<void>;
  addToast: (message: string, type?: ToastType) => void;
}

function formatTimestamp(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function NodeDetailModal({
  isOpen,
  onClose,
  node,
  projects,
  onUpdate,
  onHealthCheck,
  addToast,
}: NodeDetailModalProps) {
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!node || !isOpen) {
      setEditMode(false);
      return;
    }

    setName(node.name);
    setUrl(node.url ?? "");
    setApiKey(node.apiKey ?? "");
    setMaxConcurrent(node.maxConcurrent);
    setEditMode(false);
  }, [isOpen, node]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const assignedProjects = useMemo(() => {
    if (!node) return [];
    return projects.filter((project) => project.nodeId === node.id);
  }, [node, projects]);

  const handleHealthCheck = useCallback(async () => {
    if (!node) return;

    try {
      await onHealthCheck(node.id);
      addToast(`Health check completed for ${node.name}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Health check failed";
      addToast(message, "error");
    }
  }, [addToast, node, onHealthCheck]);

  const handleSave = useCallback(async () => {
    if (!node || isSaving) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      addToast("Name is required", "error");
      return;
    }

    if (node.type === "remote" && !url.trim()) {
      addToast("URL is required for remote nodes", "error");
      return;
    }

    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      addToast("Concurrency must be at least 1", "error");
      return;
    }

    setIsSaving(true);
    try {
      await onUpdate(node.id, {
        name: trimmedName,
        url: node.type === "remote" ? url.trim() || undefined : undefined,
        apiKey: node.type === "remote" ? apiKey || undefined : undefined,
        maxConcurrent,
      });
      addToast(`Updated ${trimmedName}`, "success");
      setEditMode(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update node";
      addToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }, [addToast, apiKey, isSaving, maxConcurrent, name, node, onUpdate, url]);

  const handleCancelEdit = useCallback(() => {
    if (!node) return;
    setName(node.name);
    setUrl(node.url ?? "");
    setApiKey(node.apiKey ?? "");
    setMaxConcurrent(node.maxConcurrent);
    setEditMode(false);
  }, [node]);

  if (!isOpen || !node) return null;

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div
        className="modal modal-lg node-detail-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Node details for ${node.name}`}
      >
        <div className="modal-header">
          <h3>Node Details</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close node detail modal">&times;</button>
        </div>

        <div className="modal-body node-detail-modal__body">
          <section className="node-detail-modal__section">
            <div className="node-detail-modal__section-header">
              <h4>Overview</h4>
              {!editMode && (
                <button className="btn btn-sm" onClick={() => setEditMode(true)}>
                  <Pencil size={14} />
                  Edit
                </button>
              )}
            </div>

            <div className="node-detail-modal__grid">
              <label className="node-detail-modal__field">
                <span>Name</span>
                {editMode ? (
                  <input value={name} onChange={(event) => setName(event.target.value)} disabled={isSaving} />
                ) : (
                  <strong>{node.name}</strong>
                )}
              </label>

              <div className="node-detail-modal__field">
                <span>Type</span>
                <strong>{node.type === "local" ? "Local" : "Remote"}</strong>
              </div>

              <div className="node-detail-modal__field">
                <span>Status</span>
                <strong>{node.status}</strong>
              </div>

              <label className="node-detail-modal__field">
                <span>Max Concurrent</span>
                {editMode ? (
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrent}
                    onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                    disabled={isSaving}
                  />
                ) : (
                  <strong>{node.maxConcurrent}</strong>
                )}
              </label>

              {node.type === "remote" && (
                <>
                  <label className="node-detail-modal__field node-detail-modal__field--full">
                    <span>URL</span>
                    {editMode ? (
                      <input value={url} onChange={(event) => setUrl(event.target.value)} disabled={isSaving} />
                    ) : (
                      <strong>{node.url ?? "—"}</strong>
                    )}
                  </label>

                  <label className="node-detail-modal__field node-detail-modal__field--full">
                    <span>API Key</span>
                    {editMode ? (
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="Leave blank to keep unchanged"
                        disabled={isSaving}
                      />
                    ) : (
                      <strong>{node.apiKey ? "••••••••" : "Not configured"}</strong>
                    )}
                  </label>
                </>
              )}

              <div className="node-detail-modal__field">
                <span>Created</span>
                <strong>{formatTimestamp(node.createdAt)}</strong>
              </div>

              <div className="node-detail-modal__field">
                <span>Updated</span>
                <strong>{formatTimestamp(node.updatedAt)}</strong>
              </div>
            </div>

            {editMode && (
              <div className="node-detail-modal__edit-actions">
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={isSaving}>
                  <Save size={14} />
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button className="btn btn-sm" onClick={handleCancelEdit} disabled={isSaving}>
                  <X size={14} />
                  Cancel
                </button>
              </div>
            )}
          </section>

          <section className="node-detail-modal__section">
            <h4>Assigned Projects ({assignedProjects.length})</h4>
            {assignedProjects.length === 0 ? (
              <p className="node-detail-modal__empty">No projects are assigned to this node.</p>
            ) : (
              <ul className="node-detail-modal__project-list">
                {assignedProjects.map((project) => (
                  <li key={project.id} className="node-detail-modal__project-item">
                    <span>{project.name}</span>
                    <code>{project.id}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="node-detail-modal__section">
            <h4>Health</h4>
            <div className="node-detail-modal__health-row">
              <span>Status: <strong>{node.status}</strong></span>
              <span>Last check: <strong>{formatTimestamp(node.updatedAt)}</strong></span>
            </div>
          </section>
        </div>

        <div className="modal-actions node-detail-modal__actions">
          <button className="btn btn-sm" onClick={handleHealthCheck}>
            <Activity size={14} />
            Health Check
          </button>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
