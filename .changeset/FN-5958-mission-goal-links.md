---
"@runfusion/fusion": minor
---

Add mission↔goal batch linking support across REST, CLI, and pi-extension surfaces.

- `POST /api/missions` and `PATCH /api/missions/:missionId` now accept optional `goalIds: string[]` for mission goal linking on create and update.
- `fn mission create --goal <id>` supports repeatable goal flags to link goals during mission creation.
- Mission goal link surfaces now reject archived goals with `GOAL_ARCHIVED` while preserving `404` for missing goals.
- Unlink paths remain permissive so archived goals can still be removed from missions.
