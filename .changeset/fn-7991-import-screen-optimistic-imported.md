---
"@runfusion/fusion": patch
---

summary: The GitHub/GitLab Import Tasks screen now marks an issue, PR, or item as "Imported" immediately after importing it.
category: fix
dev: GitHubImportModal unions a local optimistic imported-URL set (populated in handleImport/handleImportGitLab success handlers, cleared on modal reset and on provider/owner/repo/GitLab-resource change) with the tasks-derived importedUrls at every consumer (rows, count labels, top/bottom/GitLab Import buttons), so a just-imported row shows the badge and disables re-import without waiting for the tasks prop round-trip.
