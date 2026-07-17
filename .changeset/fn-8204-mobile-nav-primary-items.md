---
"@runfusion/fusion": minor
---

summary: Choose which quick-action tabs appear in the mobile footer nav.
category: feature
dev: Adds project setting `mobileNavPrimaryItems` (ordered list of the seven selectable canonical nav-item ids: command-center, tasks, agents, missions, chat, mailbox, planning); MobileNavBar renders primary tabs from it and routes omitted selectable destinations to the More sheet. Default reproduces the prior order.
