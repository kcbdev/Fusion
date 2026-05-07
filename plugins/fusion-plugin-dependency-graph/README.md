# fusion-plugin-dependency-graph

Plugin-provided top-level **Graph** dashboard view for Fusion.

## Rendering approach

- **Filtering**: includes `triage`, `todo`, `in-progress`, `in-review`; excludes `done`, `archived`
- **Graph build**: edges are resolved only from `task.dependencies` as `source=dependent`, `target=dependency`
- **Orphan dependency handling**: if a visible task depends on an excluded/missing dependency (for example `done`/`archived` after filtering), the missing edge is silently dropped and graph rendering continues without broken connectors
- **Auto-layout**: Sugiyama-style layered layout (`computeAutoLayout`) groups nodes by dependency depth and spaces layers consistently
- **Edge drawing**: SVG bezier curves from source bottom-center to target top-center, with arrowheads showing dependent → dependency direction
- **Interaction**: pan, wheel zoom, pinch zoom, zoom-in/out controls, reset, and fit-to-screen
- **Fit-to-screen**: computes node bounding box with layout node dimensions and applies zoom/pan so the graph fits in viewport with padding
- **Node rendering**: each graph node renders the real dashboard `TaskCard` via `GraphTaskNode` (no duplicated card markup)
- **In-progress behavior**: steps are visible by default and active-task glow (`agent-active`) is preserved because node cards reuse TaskCard directly
- **Active-state indicator bar**: active nodes render a compact top bar (`.graph-task-active-indicator`) with the current execution status label (for example `Executing`, `Planning`) and pulsing `--in-progress` emphasis
- **Current-step highlighting**: active nodes set `data-current-step` for valid native step indices so CSS selectors highlight the currently executing `.card-step-item` and pulse its step dot
- **Zoom-out differentiation**: `.graph-task-node--active` adds amplified glow and subtle scale/border tint so active nodes remain distinguishable at reduced zoom levels
- **In-review visual treatment**: `in-review` nodes get a static `.graph-task-node--in-review` left accent in `--in-review` to distinguish waiting-review work from active execution nodes
- **Graph node classes**: `.graph-task-node`, `.graph-task-node--active`, `.graph-task-node--in-review`, `.graph-task-node--highlighted`, and `.graph-task-node--dimmed` are available for graph-specific layering/highlight states while card internals remain owned by `TaskCard.css`
- **Drag behavior**: graph nodes pass `disableDrag={true}` to `TaskCard` so card-level HTML5 drag does not conflict with canvas pan/zoom

## Controls

- **Fit to screen** (`Maximize`)
- **Zoom in** (`ZoomIn`)
- **Zoom out** (`ZoomOut`)

All controls are rendered as floating `.btn-icon` actions in the bottom-right corner, with mobile-friendly sizing in the `@media (max-width: 768px)` override.
