---
"@runfusion/fusion": patch
---

Dashboard UI for the worktrunk install approval: when worktrunk auto-install (FN-4624) is triggered from the dashboard, Fusion now creates a `network_api` approval request visible in the Approvals view. Approving the request runs the install with the gate pre-satisfied; denying it leaves the binary uninstalled.
