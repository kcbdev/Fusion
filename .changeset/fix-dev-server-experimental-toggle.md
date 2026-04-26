---
"@runfusion/fusion": patch
---

Fix experimental feature save normalization so disabling Dev Server clears the legacy `devServer` alias (`null` delete) alongside canonical `devServerView`, preventing stale nav visibility after save.
