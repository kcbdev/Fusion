# fusion-plugin-cli-printing-press

Bundled first-party Fusion plugin that adds a plugin-owned dashboard wizard for drafting an external service CLI definition.

## v1 scope (FN-3763 + FN-3764)

- Provides two dashboard views:
  - **Create Service CLI** (`viewId: wizard`)
  - **Manage Service CLIs** (`viewId: manage`)
- Wizard collects service basics, HTTP transport details, endpoints, and non-OAuth credential placeholders
- Manage view supports list/inspect/edit/regenerate/delete against saved drafts
- Saves draft payloads to interim JSON files under:
  - `<projectRoot>/.fusion/plugins/cli-printing-press/drafts/<id>.json`
- Regenerate in v1 is a stub endpoint that re-saves the draft and returns:
  - `stub: true`
  - `message: "Regenerate stub — full generation lands in FN-3765/FN-3767"`

## Provisional architecture assumptions (pending FN-3762/FN-3766)

The following choices are intentionally provisional and may be revised by architecture/storage follow-up work:

- `PluginContext` usage pattern in route handlers
- Express route shape and plugin-relative path conventions
- Credential union shape for wizard payloads (non-OAuth only in v1)
- Draft storage location and JSON schema

## Deferred follow-ups

- OAuth credential flows: **FN-3762 / FN-3766**
- Run/test actions and real generator execution: **FN-3765**
- Canonical storage migration (replace JSON stash): **FN-3766**
- Runtime exposure/integration: **FN-3767**
- Workflow-step exposure: **FN-3768**

## Frontend API target

Plugin views call host-prefixed plugin routes under `/api/plugins/fusion-plugin-cli-printing-press/`:

- `POST /drafts` — save draft
- `GET /drafts` — list summaries
- `GET /drafts/:id` — fetch full draft
- `PUT /drafts/:id` — update draft
- `POST /drafts/:id/regenerate` — v1 stub regenerate response
- `DELETE /drafts/:id` — remove draft
