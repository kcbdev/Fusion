---
"@runfusion/fusion": patch
---

Fix fusion startup crash caused by the roadmap plugin's main entry re-exporting `RoadmapDashboardView`, which transitively imported a `.css` file under Node's tsx ESM loader. The dashboard view is still reachable through the dedicated `./dashboard-view` subpath used by the bundled-view registry.
