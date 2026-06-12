---
"@runfusion/fusion": patch
---

Fix custom provider models not appearing in model dropdowns. The `/models` endpoint filtered results to providers configured in Fusion's auth stores, which excluded custom providers (stored in global settings). Their registry keys are now added to the allowlist so their models surface in pickers.
