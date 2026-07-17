---
"@runfusion/fusion": patch
---

summary: Fix WhatsApp Chat plugin failing to connect (405 rejection) and its bundled build failing to load.
category: fix
dev: connect() now passes fetchLatestBaileysVersion() to makeWASocket so WhatsApp accepts the handshake; /status exposes lastError; plugin bundled.js builds get the createRequire ESM banner so CJS deps (Baileys) can require node builtins.
