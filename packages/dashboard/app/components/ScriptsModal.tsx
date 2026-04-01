import { useState, useEffect, useCallback } from "react";
import { X, Plus, Play, Trash2, Terminal, Check, AlertCircle } from "lucide-react";
import {
  fetchScripts,
  addScript,
  removeScript,
  type ScriptRunResult,
} from "../api";
import type { ToastType } from "../hooks/useToast";

interface ScriptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: ToastType) => void;
  onRunScript?: (name: string, command: string) => void;
}

interface ScriptFormData {
  name: string;
  command: string;
}

const EMPTY_FORM: ScriptFormData = {
  name: "",
  command: "",
};

export function ScriptsModal({ isOpen, onClose, addToast, onRunScript }: ScriptsModalProps) {
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<ScriptFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      const data = await fetchScripts();
      setScripts(data);
    } catch (err: any) {
      addToast(err.message || "Failed to load scripts", "error");
    } finally {
      setLoading(false);
    }
  }, [isOpen, addToast]);

  useEffect(() => {
    if (isOpen) {
      loadScripts();
    }
  }, [isOpen, loadScripts]);

  const validateScriptName = (name: string): string | null => {
    if (!name.trim()) {
      return "Script name is required";
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
      return "Name must be alphanumeric with hyphens and underscores only (no spaces)";
    }
    // Check for reserved names
    const reservedNames = ["run", "list", "add", "remove", "delete", "help"];
    if (reservedNames.includes(name.trim().toLowerCase())) {
      return `Script name '${name.trim()}' is reserved`;
    }
    return null;
  };

  const handleCreate = useCallback(() => {
    setIsCreating(true);
    setEditingName(null);
    setForm(EMPTY_FORM);
    setValidationError(null);
  }, []);

  const handleEdit = useCallback((name: string, command: string) => {
    setIsCreating(false);
    setEditingName(name);
    setForm({ name, command });
    setValidationError(null);
  }, []);

  const handleCancel = useCallback(() => {
    setIsCreating(false);
    setEditingName(null);
    setForm(EMPTY_FORM);
    setValidationError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = form.name.trim();
    const trimmedCommand = form.command.trim();

    // Validate name
    const nameError = validateScriptName(trimmedName);
    if (nameError) {
      setValidationError(nameError);
      return;
    }

    if (!trimmedCommand) {
      setValidationError("Command is required");
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      await addScript(trimmedName, trimmedCommand);
      addToast(
        isCreating ? `Script '${trimmedName}' created` : `Script '${trimmedName}' updated`,
        "success"
      );
      setIsCreating(false);
      setEditingName(null);
      setForm(EMPTY_FORM);
      await loadScripts();
    } catch (err: any) {
      const message = err.message || "Failed to save script";
      setValidationError(message);
      addToast(message, "error");
    } finally {
      setSaving(false);
    }
  }, [form, isCreating, addToast, loadScripts]);

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        await removeScript(name);
        addToast(`Script '${name}' deleted`, "success");
        setDeleteConfirmName(null);
        if (editingName === name) {
          setEditingName(null);
          setForm(EMPTY_FORM);
        }
        await loadScripts();
      } catch (err: any) {
        addToast(err.message || "Failed to delete script", "error");
      }
    },
    [editingName, addToast, loadScripts]
  );

  const handleRunScript = useCallback(
    (name: string, command: string) => {
      if (onRunScript) {
        onRunScript(name, command);
      } else {
        addToast("Terminal not available", "error");
      }
    },
    [onRunScript, addToast]
  );

  if (!isOpen) return null;

  const isEditing = isCreating || editingName !== null;
  const scriptEntries = Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="scripts-modal">
      <div
        className="modal scripts-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Scripts Manager"
      >
        {/* Header */}
        <div className="modal-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Terminal size={18} />
            Scripts
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "16px", maxHeight: "70vh", overflowY: "auto" }}>
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "32px",
                color: "var(--text-secondary)",
              }}
              data-testid="scripts-loading"
            >
              Loading...
            </div>
          ) : (
            <>
              {/* Script List */}
              {!isEditing && (
                <>
                  {scriptEntries.length === 0 && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "32px",
                        color: "var(--text-secondary)",
                        fontSize: "14px",
                      }}
                      data-testid="scripts-empty-state"
                    >
                      No scripts defined yet. Add your first script to run quick commands.
                    </div>
                  )}

                  {scriptEntries.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {scriptEntries.map(([name, command]) => (
                        <div
                          key={name}
                          className="script-card"
                          data-testid={`script-item-${name}`}
                          style={{
                            padding: "12px 16px",
                            border: "1px solid var(--border-primary)",
                            borderRadius: "8px",
                            background: "var(--bg-secondary)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  marginBottom: "4px",
                                }}
                              >
                                <span style={{ fontWeight: 600, fontSize: "14px" }}>{name}</span>
                              </div>
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "var(--text-secondary)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontFamily: "monospace",
                                }}
                                title={command}
                              >
                                {command.length > 60 ? `${command.slice(0, 60)}...` : command}
                              </div>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: "4px",
                                marginLeft: "8px",
                                flexShrink: 0,
                              }}
                            >
                              <button
                                className="btn-icon"
                                onClick={() => handleRunScript(name, command)}
                                title={`Run ${name}`}
                                aria-label={`Run script ${name}`}
                                data-testid={`run-script-${name}`}
                              >
                                <Play size={14} />
                              </button>
                              <button
                                className="btn-icon"
                                onClick={() => handleEdit(name, command)}
                                title="Edit"
                                aria-label={`Edit script ${name}`}
                                data-testid={`edit-script-${name}`}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                              </button>
                              {deleteConfirmName === name ? (
                                <div
                                  style={{ display: "flex", gap: "4px", alignItems: "center" }}
                                >
                                  <button
                                    className="btn-icon"
                                    onClick={() => handleDelete(name)}
                                    title="Confirm delete"
                                    aria-label={`Confirm delete script ${name}`}
                                    style={{ color: "var(--status-error, #ef4444)" }}
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    className="btn-icon"
                                    onClick={() => setDeleteConfirmName(null)}
                                    title="Cancel delete"
                                    aria-label="Cancel delete"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn-icon"
                                  onClick={() => setDeleteConfirmName(name)}
                                  title="Delete"
                                  aria-label={`Delete script ${name}`}
                                  data-testid={`delete-script-${name}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Edit / Create form */}
              {isEditing && (
                <div
                  style={{
                    padding: "16px",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "8px",
                    background: "var(--bg-secondary)",
                  }}
                  data-testid="script-form"
                >
                  <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 600 }}>
                    {isCreating ? "New Script" : "Edit Script"}
                  </h3>

                  {/* Validation error */}
                  {validationError && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 12px",
                        marginBottom: "12px",
                        background: "rgba(239, 68, 68, 0.1)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "6px",
                        color: "var(--status-error, #ef4444)",
                        fontSize: "13px",
                      }}
                      data-testid="script-validation-error"
                    >
                      <AlertCircle size={14} />
                      {validationError}
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {/* Name */}
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          marginBottom: "4px",
                        }}
                      >
                        Script Name
                      </label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                        placeholder="e.g. build, test, deploy"
                        disabled={!isCreating}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-primary)",
                          background: isCreating ? "var(--bg-primary)" : "var(--bg-tertiary)",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                        }}
                        data-testid="script-name-input"
                      />
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          marginTop: "4px",
                        }}
                      >
                        Alphanumeric with hyphens and underscores only. No spaces.
                      </div>
                    </div>

                    {/* Command */}
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          marginBottom: "4px",
                        }}
                      >
                        Command
                      </label>
                      <textarea
                        value={form.command}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, command: e.target.value }))
                        }
                        placeholder="e.g. npm run build"
                        rows={3}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-primary)",
                          background: "var(--bg-primary)",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                          fontFamily: "monospace",
                          resize: "vertical",
                        }}
                        data-testid="script-command-input"
                      />
                    </div>

                    {/* Form actions */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "4px",
                      }}
                    >
                      <button className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={saving || !form.name.trim() || !form.command.trim()}
                        data-testid="save-script-btn"
                      >
                        {saving ? "Saving..." : isCreating ? "Create" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!isEditing && (
          <div
            className="modal-footer"
            style={{ padding: "12px 16px", borderTop: "1px solid var(--border-primary)" }}
          >
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
              data-testid="add-script-btn"
            >
              <Plus size={14} />
              Add Script
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
