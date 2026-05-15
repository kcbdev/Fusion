---
"@runfusion/fusion": patch
---

Fix Dockerfile workspace manifest copying to match the current monorepo layout by removing the stale `packages/tui` reference and including plugin/package manifests required for `pnpm install --frozen-lockfile` during image builds. This restores successful `docker build .` behavior without changing runtime features.
