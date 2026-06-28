---
"@runfusion/fusion": patch
---

summary: The PR number in a task's Pull Request tab now links to the pull request on GitHub.
category: feature
dev: PrCard (PrPanel.tsx) wraps the pr-number in an anchor to prInfo.url (new tab, rel=noopener); plain-span fallback when no URL.
