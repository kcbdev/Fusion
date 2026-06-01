---
"@runfusion/fusion": patch
---

Classify provider 400 errors for unsupported `messages.[n].role` values as operator-actionable agent errors, and annotate prompt-boundary failures with a clear model/provider compatibility hint. This stops invisible retry loops and makes misconfigured imported agent model/provider combinations fail fast with actionable diagnostics.
