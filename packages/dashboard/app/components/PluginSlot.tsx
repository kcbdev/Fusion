import type { ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { DroidCliProviderCard } from "./DroidCliProviderCard";
import { usePluginUiSlots } from "../hooks/usePluginUiSlots";
import "./PluginSlot.css";

interface PluginSlotProps {
  /** The slot identifier to render (e.g., "task-detail-tab", "header-action") */
  slotId: string;
  /** Optional project ID for multi-project slot scoping */
  projectId?: string;
  /** Optional plugin IDs to restrict rendering to a subset of matching entries */
  pluginIds?: string[];
  /** Render fallback shell placeholders while dynamic slot component mounting is unavailable */
  renderPlaceholder?: boolean;
}

function renderKnownPluginSlot(slotId: string, pluginId: string): ReactNode | null {
  if (pluginId === "fusion-plugin-droid-runtime" && slotId === "settings-provider-card") {
    return <DroidCliProviderCard compact authenticated={false} />;
  }

  return null;
}

/**
 * Renders plugin slot registrations for a host surface.
 */
export function PluginSlot({ slotId, projectId, pluginIds, renderPlaceholder = true }: PluginSlotProps): ReactNode {
  const { getSlotsForId, loading, error } = usePluginUiSlots(projectId);

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
        {matchingEntries.map((entry, index) => {
          const knownSlot = renderKnownPluginSlot(entry.slot.slotId, entry.pluginId);
          if (knownSlot) {
            return <div key={`${entry.pluginId}-${entry.slot.slotId}-${index}`}>{knownSlot}</div>;
          }

          if (!renderPlaceholder) {
            return null;
          }

          return (
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
          );
        })}
      </>
    </ErrorBoundary>
  );
}
