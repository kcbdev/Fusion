---
"@runfusion/fusion": patch
---

Three small UX fixes on the agent list card.

- **Optimistic Run Now**: clicking the Run Now button now flips the card's state badge to `running` immediately. The `startAgentRun` API call can take several seconds, and the prior code awaited it before any visual feedback, leaving users unsure whether the click registered. Mirrors the existing `handleStateChange` pattern — stamp the override, await the API, refresh on success, roll back on failure.
- **Whole-card clickable**: the entire `.agent-card` body opens the agent detail view, not just the name/icon area. Clicks on action buttons (Run Now, Pause, Details, Delete), the role-edit select, and the role-icon button keep their dedicated behaviors via a target check that bails on interactive descendants. `role="button"`, `tabIndex`, and Enter/Space handling preserve keyboard access; a `--focus-ring` outline shows the focus state.
- **Single-row card actions**: renamed "View Details" → "Details" and switched `.agent-card-actions` to `flex-wrap: nowrap` with per-button `flex-shrink: 0; white-space: nowrap` so Run Now / Pause / Details stay on one row regardless of card width.
