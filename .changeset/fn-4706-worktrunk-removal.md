---
"@runfusion/fusion": minor
---

Disable the worktrunk auto-install path. The pinned cognitive-engineering-lab/worktrunk v0.4.2 release is no longer reachable (see FN-4704/FN-4705), so `installWorktrunk()` now throws `WorktrunkInstallFailedError` immediately. Users who opt into `worktrunk.enabled` must set `worktrunk.binaryPath` or place `worktrunk` on `$PATH`. Auto-install will return once an authoritative upstream release source is re-established. `WORKTRUNK_PINNED_RELEASE` and the release-download helpers are removed from `@fusion/engine` exports.
