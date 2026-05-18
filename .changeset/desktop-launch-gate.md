---
"@runfusion/fusion": minor
---

Add a desktop launch gate so the packaged Fusion app prompts the user to either run Fusion locally (starts the embedded runtime and points the dashboard at it via `?serverBaseUrl=…`) or connect to a remote Fusion server, instead of immediately showing a "can't reach backend" error.
