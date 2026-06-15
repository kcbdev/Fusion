# ACP (Agent Client Protocol) Runtime Contract

Date: 2026-06-03

Launch/readiness contract and failure taxonomy for `fusion-plugin-acp-runtime`,
which drives any external [Agent Client Protocol](https://agentclientprotocol.com)
agent over JSON-RPC/stdio. Mirrors the shape of `docs/cursor-cli-contract.md`.

## Transport

- **Newline-delimited JSON-RPC 2.0 over stdio** (no Content-Length framing).
  Provided by `@agentclientprotocol/sdk` (`ndJsonStream` + `ClientSideConnection`).
- The client (Fusion) launches the agent as a subprocess with piped stdio. The
  agent's stdin is the JSON-RPC *output* stream; its stdout is the *input* stream.
- `stderr` is captured (redacted) for diagnostics, never parsed as protocol.

## Invocation and binary detection

- Unlike a single-vendor CLI, ACP is a protocol — the agent binary + ACP-mode
  flag are user-configured:
  - `acpBinaryPath` — e.g. `gemini`, `npx`, or an absolute path.
  - `acpArgs` — the flag(s) that put the agent in ACP/stdio mode, e.g. `["--acp"]`.
- The subprocess environment is built from the `acpEnvAllowList` allow-list only
  (inherited `process.env` is **not** forwarded — the agent is untrusted).

## Claude bridge ask profile (Route B)

Route-B planning and validator asks use the `acp` runtime with the bundled
`claude-code-cli-acp` bridge instead of `claude -p`:

- `claude-code-cli-acp@0.1.1` is pinned under the ACP runtime plugin and the
  sentinel binary name resolves to this plugin's own `node_modules/.bin` shim,
  not to a PATH-selected substitute.
- The read-only ask posture uses `tools: "readonly"`, `acpArgs: []`, and leaves
  `acpFsRead` / `acpFsWrite` off. Route A's tool-bearing provider path remains
  deferred and is not implied by this profile.
- The Claude bridge env allow-list is intentionally narrow: `HOME` is forwarded
  so the underlying `claude` can read `~/.claude` auth/session state, and `PATH`
  is forwarded for sub-executable resolution. `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, and inherited `process.env` are not forwarded.
- `checkSetup` treats the bridge as installed only when the resolved binary is
  plugin-owned, the ACP handshake succeeds, and no Claude auth hint is returned.
  Auth-needed statuses tell the operator to run `claude` once to authenticate.

## `askAcpOnce` prose → JSON recovery contract

The engine-side `askAcpOnce` runner creates one readonly ACP session, accumulates
all `onText` deltas into `text`, runs one `promptWithFallback` turn, optionally
recovers the trailing JSON object via `extractJsonObjects`, and disposes the
session in `finally`. Its shape is deliberately close to the old one-shot result:

- Success: `{ ok: true, text, parsed?, stopReason? }`.
- Failure: `{ ok: false, reason, message, text?, stopReason? }` for session
  creation errors, turn errors, timeouts, and abnormal stops.
- `promptWithFallback` surfaces ACP `stopReason` to the runner. Planning tolerates
  an absent stop reason, but validation treats abnormal/truncated stops such as
  `max_tokens` and `cancelled` as `error` regardless of any recovered JSON.
- Validator prose fallback is constrained: prose can infer `fail` or `blocked`,
  but never `pass`. A pass requires clean structured JSON (`verdict:"pass"` or
  `passed:true`) from a clean turn.

## Readiness = the `initialize` handshake

There is no `--version` probe. Readiness is the protocol handshake itself:

1. Spawn the agent subprocess.
2. Send `initialize { protocolVersion: 1, clientCapabilities: { fs } }` under a
   timeout (default 30s — research flagged Gemini-on-macOS OAuth and Claude-adapter
   `session/new` stalls).
3. The agent responds with its integer `protocolVersion`, `agentCapabilities`,
   and `authMethods`.
4. The client compares the integer protocol version; an unsupported version is a
   hard failure (do not assume the agent errors first).

`fs` capabilities are advertised **only** when `acpFsRead`/`acpFsWrite` are
enabled (writes default OFF).

## Failure taxonomy (`probe.ts` `AcpProbeReason`)

| Reason | Trigger |
| --- | --- |
| `ok` | Handshake completed (with `authRequired: true` when `authMethods` is non-empty) |
| `missing_binary` | Spawn `ENOENT` (binary not found, code 127) |
| `spawn_error` | Other spawn failure |
| `handshake_timeout` | `initialize` did not complete within the bound (code 124) |
| `incompatible_protocol` | Agent negotiated an unsupported integer protocol version |
| `unauthenticated` | Agent requires an auth method the client cannot satisfy |

## Lifecycle / teardown

- The engine has no `AbortSignal` in the runtime contract; teardown enters via an
  unawaited synchronous `dispose()` plus the process-registry kill. The
  **registry SIGKILL is the authoritative no-orphan / no-deadlock guarantee**; a
  best-effort `session/cancel` + pending-permission drain runs first when timing
  allows but is opportunistic.

## Sources

- https://agentclientprotocol.com (introduction, schema, transports, initialization, tool-calls)
- `@agentclientprotocol/sdk` v0.24.0 — https://www.npmjs.com/package/@agentclientprotocol/sdk
- Validation: the SDK example echo agent (CI) + an in-repo controllable fixture
  (`src/__tests__/fixtures/echo-agent.mjs`); Gemini CLI / Claude-adapter for manual e2e.
