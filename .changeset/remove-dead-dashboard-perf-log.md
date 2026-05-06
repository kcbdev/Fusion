---
"@runfusion/fusion": patch
---

Remove the dead `reportDashboardPerf` client and its five call sites in
`App.tsx` / `useProjects.ts`. The companion server route `/_perf/dashboard-load`
no longer exists, so every call was a silently-swallowed 404. Also drops the
`dashboard-perf.log` runtime ignore-list entry from
`scripts/check-test-isolation.mjs` since nothing creates that file anymore.
Console-side perf logging via `console.log("[App] …")` and
`console.log("[useProjects] …")` is preserved.
