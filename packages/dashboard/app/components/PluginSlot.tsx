import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { usePluginUiSlots } from "../hooks/usePluginUiSlots";
import "./PluginSlot.css";

interface PluginSlotProps {
  /** The slot identifier to render (e.g., "task-detail-tab", "header-action") */
  slotId: string;
  /** Optional project ID for multi-project slot scoping */
  projectId?: string;
  /** Optional plugin IDs to restrict rendering to a subset of matching entries */
  pluginIds?: string[];
}

/**
 * Renders plugin slot registrations for a host surface.
 *
 * Dynamic plugin component loading is not yet available, so this renders a
 * lightweight non-technical placeholder while preserving plugin slot boundaries.
 * Each rendered slot is wrapped in an ErrorBoundary to isolate failures from
 * the parent dashboard UI.
 */
export function PluginSlot({ slotId, projectId, pluginIds }: PluginSlotProps): ReactNode {
  const { getSlotsForId, loading, error } = usePluginUiSlots(projectId);

  // Non-critical failure — no visible UI when loading, errored, or no matching slots
  if (loading || error || !slotId) {
    return null;
  }

  const matchingEntries = getSlotsForId(slotId).filter((entry) =>
    pluginIds && pluginIds.length > 0 ? pluginIds.includes(entry.pluginId) : true,
  );

  if (matchingEntries.length === 0) {
    return null;
  }

  return (
    <ErrorBoundary level="page">
      <>
        {matchingEntries.map((entry, index) => (
          <section
            key={`${entry.pluginId}-${entry.slot.slotId}-${index}`}
            className="plugin-slot-shell"
            data-plugin-slot
            data-slot-id={entry.slot.slotId}
            data-plugin-id={entry.pluginId}
            aria-label={entry.slot.label}
          >
            <p className="plugin-slot-shell__title">{entry.slot.label}</p>
            <p className="plugin-slot-shell__message">Extension content available.</p>
          </section>
        ))}
      </>
    </ErrorBoundary>
  );
}
