---
"@runfusion/fusion": patch
---

Manual task retry now resets the full persisted retry-budget counter set (and `nextRecoveryAt`) across CLI, pi extension, and dashboard retry surfaces, so retry badges/details no longer stay inflated after a user-triggered fresh attempt.
