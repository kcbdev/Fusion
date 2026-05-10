import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useConfirm } from "../hooks/useConfirm";
import "./StashRecoveryView.css";

type RecordItem = {
  sha: string;
  sourceTaskId: string | null;
  createdAt: string | null;
  classification: "subsumed" | "live" | "unknown";
  changedPaths: string[];
};

type DiffResponse = {
  diff: string;
  truncated: boolean;
};

export function StashRecoveryView() {
  const { confirm } = useConfirm();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<Record<string, string>>({});
  const [diffState, setDiffState] = useState<{ sha: string; diff: string; truncated: boolean; loading: boolean; error: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api<{ records: RecordItem[] }>("/stash-recovery/orphans");
      setRecords(data.records ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orphans");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, RecordItem[]>();
    for (const record of records) {
      const key = record.sourceTaskId ?? "Unknown source";
      const existing = map.get(key) ?? [];
      existing.push(record);
      map.set(key, existing);
    }
    return Array.from(map.entries());
  }, [records]);

  const handleApply = useCallback(async (sha: string) => {
    const result = await api<{ ok: boolean; reason?: string; stderr?: string }>(`/stash-recovery/orphans/${sha}/apply`, { method: "POST" });
    setApplyState((prev) => ({ ...prev, [sha]: result.ok ? "Applied" : result.stderr ?? result.reason ?? "Apply failed" }));
  }, []);

  const handleDrop = useCallback(async (sha: string) => {
    const shouldDrop = await confirm({
      title: "Drop orphaned stash?",
      message: "This removes the stash entry permanently.",
      confirmLabel: "Drop",
      danger: true,
    });
    if (!shouldDrop) return;
    await api(`/stash-recovery/orphans/${sha}/drop`, { method: "POST", body: JSON.stringify({ confirm: true }) });
    await load();
  }, [confirm, load]);

  const handleInspectDiff = useCallback(async (sha: string) => {
    setDiffState({ sha, diff: "", truncated: false, loading: true, error: null });
    try {
      const data = await api<DiffResponse>(`/stash-recovery/orphans/${sha}/diff`);
      setDiffState({ sha, diff: data.diff ?? "", truncated: Boolean(data.truncated), loading: false, error: null });
    } catch (err) {
      setDiffState({ sha, diff: "", truncated: false, loading: false, error: err instanceof Error ? err.message : "Failed to load diff" });
    }
  }, []);

  if (records.length === 0 && !error) {
    return <div className="card stash-recovery-view"><p>No orphaned merger autostashes found.</p><button className="btn btn-sm" onClick={() => void load()}>Refresh</button></div>;
  }

  return (
    <div className="card stash-recovery-view">
      <div className="stash-recovery-header">
        <h2>Stash Recovery</h2>
        <span>{records.length} orphans</span>
        <button className="btn btn-sm" onClick={() => void load()}>Refresh</button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {groups.map(([group, items]) => (
        <section key={group}>
          <h3>{group}</h3>
          {items.map((item) => (
            <div key={item.sha} className="stash-row">
              <div className="stash-field">
                <span className="stash-field-label">SHA</span>
                <span>{item.sha.slice(0, 7)}</span>
              </div>
              <div className="stash-field">
                <span className="stash-field-label">Classification</span>
                <span>{item.classification}</span>
              </div>
              <div className="stash-field">
                <span className="stash-field-label">Changed paths</span>
                <span>{item.changedPaths.length} files</span>
              </div>
              <div className="stash-row-actions">
                <button className="btn btn-sm stash-action-btn" onClick={() => void handleInspectDiff(item.sha)}>Inspect diff</button>
                <button className="btn btn-sm stash-action-btn" onClick={() => void handleApply(item.sha)}>Apply</button>
              </div>
              <div className="stash-row-actions-danger">
                <button className="btn btn-sm btn-danger stash-action-btn" onClick={() => void handleDrop(item.sha)}>Drop</button>
              </div>
              {applyState[item.sha] && <div className="stash-status">{applyState[item.sha]}</div>}
            </div>
          ))}
        </section>
      ))}
      {diffState && (
        <div className="modal-overlay open" onClick={() => setDiffState(null)}>
          <div className="modal stash-recovery-diff-modal" role="dialog" aria-modal="true" aria-label={`Diff for ${diffState.sha}`} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Diff for {diffState.sha.slice(0, 7)}</h3>
              <button className="modal-close" onClick={() => setDiffState(null)} aria-label="Close diff dialog">
                &times;
              </button>
            </div>
            {diffState.loading && <p>Loading diff…</p>}
            {diffState.error && <div className="form-error">{diffState.error}</div>}
            {!diffState.loading && !diffState.error && (
              <>
                <pre className="stash-recovery-diff-pre">{diffState.diff || "No diff output available."}</pre>
                {diffState.truncated && <p className="stash-status">Diff output truncated.</p>}
              </>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setDiffState(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
