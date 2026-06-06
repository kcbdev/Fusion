/**
 * Code-enforced pre-push secret guard for CE sessions (security issue #3).
 *
 * ## The gap this closes
 *
 * The standard PR-respond pipeline ({@link ./pr-response-run.ts}) runs a real
 * `scanForSecrets` over the about-to-be-pushed diff and ABORTS the push when a
 * credential is found — the engine owns the push, so the scan is a hard code gate.
 *
 * On CE boards the respond step is replaced by `dispatchCePrRespond`
 * ({@link ./ce-dispatch.ts}), which launches the `ce-resolve-pr-feedback` stage as
 * an interactive (or headless/LFG) AI session through the plugin orchestrator. That
 * session has its OWN shell and can run `git push` itself. The skill's "pre-push
 * secret scan" and "bot denylist" are natural-language instructions only — there is
 * NO code that forces the scan on the CE push path. Under LFG (headless) autonomy a
 * compromised/confused session could push a secret-bearing commit unchecked.
 *
 * ## Why a git pre-push hook is the enforceable chokepoint
 *
 * The session is untrusted: we cannot rely on it to run the scan, and we cannot
 * intercept the push from the engine because the SESSION issues the push, not the
 * engine. The only chokepoint git itself enforces on the session's own `git push`
 * is a `pre-push` hook installed in the worktree's git dir. The hook:
 *   - runs git-side at push time, before any object reaches origin,
 *   - scans the exact commit range being pushed with the SAME secret patterns the
 *     standard path uses ({@link SECRET_PATTERNS}, serialized into the hook),
 *   - exits non-zero (aborting the push) and writes a persisted audit marker when a
 *     credential is found,
 *   - is dependency-free (only `git` + `node`, both already required to run a CE
 *     session), so it works identically in interactive and headless modes.
 *
 * Options (b) "engine pushes after a post-session scan" and (c) "shim git in the
 * env" were rejected: (b) assumes the engine owns the push (it does not — the
 * session does), and (c) is bypassable (the session can invoke git by absolute path
 * or reset PATH). The hook is enforced by git regardless of how the push is invoked.
 *
 * The skill prose stays as defense-in-depth; THIS is the code enforcement.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SECRET_PATTERNS } from "./pr-response-run.js";

const execFileAsync = promisify(execFile);

/** Relative path (under the worktree's git dir) of the marker the hook writes when
 *  it blocks a push. The engine reads it to persist a task-log audit entry. */
export const CE_PREPUSH_BLOCK_MARKER = "fusion-ce-prepush-block.json";

/** Stable task-log prefix surfaced when the pre-push guard blocked a CE push. */
export const CE_PREPUSH_BLOCKED_LOG_PREFIX = "CE push blocked [secret-scan]:";

/** Result of installing the guard into a worktree. */
export interface InstallCePrePushGuardResult {
  /** True when the hook was written (or already current). */
  installed: boolean;
  /** Absolute path of the installed hook, when installed. */
  hookPath?: string;
  /** Absolute path of the git dir whose hooks dir was used. */
  gitDir?: string;
  /** A non-fatal reason the guard could not be installed (worktree not a git repo,
   *  fs error). Install failures NEVER throw — the caller proceeds (the standard
   *  path's own scan still applies on degrade) but the gap is logged. */
  skippedReason?: string;
}

/**
 * Resolve the git COMMON dir (where `hooks/` lives) for a worktree. A linked
 * worktree's `.git` is a file (`gitdir: <path>`) pointing at
 * `<repo>/.git/worktrees/<name>`; hooks are shared from the common dir
 * (`<repo>/.git`). We ask git directly so both the main checkout and linked
 * worktrees resolve correctly.
 */
export async function resolveWorktreeHooksDir(
  worktreePath: string,
): Promise<{ gitDir: string; hooksDir: string } | null> {
  try {
    // `--git-common-dir` is where shared hooks live (vs. the per-worktree git dir).
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd: worktreePath },
    );
    const raw = stdout.trim();
    if (!raw) return null;
    const gitDir = resolve(worktreePath, raw);
    // Respect an explicit core.hooksPath if one is configured; else <gitDir>/hooks.
    let hooksDir = join(gitDir, "hooks");
    try {
      const { stdout: hp } = await execFileAsync(
        "git",
        ["config", "--get", "core.hooksPath"],
        { cwd: worktreePath },
      );
      const configured = hp.trim();
      if (configured) hooksDir = resolve(worktreePath, configured);
    } catch {
      /* no core.hooksPath set — default hooks dir */
    }
    return { gitDir, hooksDir };
  } catch {
    return null;
  }
}

/**
 * Build the pre-push hook script. Self-contained POSIX-sh wrapper that runs an
 * inline node scanner. The scanner:
 *   1. reads the push protocol on stdin (`<localRef> <localOid> <remoteRef> <remoteOid>`),
 *   2. for each updated ref, diffs the pushed range (`<remoteOid>..<localOid>`,
 *      or the full history of the new tip when the remote ref does not yet exist),
 *   3. reads the blob content of every changed path at the local tip,
 *   4. scans with the SAME patterns as {@link SECRET_PATTERNS},
 *   5. on a finding: writes a JSON audit marker into the git dir and exits 1
 *      (git aborts the push); otherwise exits 0.
 *
 * The patterns are serialized from {@link SECRET_PATTERNS} so the hook and the
 * standard-path scan never drift (a unit test asserts parity).
 */
export function buildPrePushHookScript(markerPath: string): string {
  // Serialize the shared patterns as [kind, source, flags] tuples.
  const serialized = SECRET_PATTERNS.map((p) => [p.kind, p.re.source, p.re.flags]);
  const patternsJson = JSON.stringify(serialized);
  const markerJson = JSON.stringify(markerPath);

  // The node program is embedded verbatim; it is intentionally dependency-free.
  const nodeProgram = `
const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const PATTERNS = ${patternsJson}.map(([kind, source, flags]) => ({ kind, re: new RegExp(source, flags) }));
const MARKER = ${markerJson};
const ZERO = "0000000000000000000000000000000000000000";
function git(args) {
  try { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ""; }
}
function scan(path, text) {
  const out = [];
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const raw = m[0];
      const excerpt = raw.length <= 8 ? "***" : raw.slice(0, 4) + "\\u2026" + raw.slice(-2);
      out.push({ path, kind, excerpt });
    }
  }
  return out;
}
const input = require("node:fs").readFileSync(0, "utf8");
const lines = input.split("\\n").map((l) => l.trim()).filter(Boolean);
const findings = [];
const seen = new Set();
for (const line of lines) {
  const [localRef, localOid, remoteRef, remoteOid] = line.split(/\\s+/);
  if (!localOid || localOid === ZERO) continue; // a branch deletion pushes nothing
  const range = !remoteOid || remoteOid === ZERO ? localOid : remoteOid + ".." + localOid;
  const names = git(["diff", "--name-only", range]).split("\\n").map((l) => l.trim()).filter(Boolean);
  for (const path of names) {
    if (seen.has(path)) continue;
    seen.add(path);
    const content = git(["show", localOid + ":" + path]);
    if (content) findings.push(...scan(path, content));
  }
}
if (findings.length > 0) {
  try {
    writeFileSync(MARKER, JSON.stringify({ blockedAt: new Date().toISOString(), findings }, null, 2));
  } catch { /* best-effort marker */ }
  process.stderr.write(
    "\\n\\u274c fusion: push BLOCKED — secret-scan found credential-looking content:\\n" +
      findings.map((f) => "  - " + f.kind + " @ " + f.path + " (" + f.excerpt + ")").join("\\n") +
      "\\n\\nRemove the secret(s) and amend the commit before pushing.\\n\\n",
  );
  process.exit(1);
}
process.exit(0);
`.trim();

  return [
    "#!/bin/sh",
    "# fusion CE pre-push secret guard (security issue #3) — DO NOT EDIT.",
    "# Code-enforced credential scan for pushes from a CE AI session. Installed by",
    "# @fusion/engine ce-prepush-guard before launching a CE PR-respond stage.",
    "exec node -e " + shellSingleQuote(nodeProgram),
    "",
  ].join("\n");
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Install (idempotently) the pre-push secret guard into a task worktree's git
 * hooks dir. Returns a structured result; NEVER throws (a failure to install is
 * logged and surfaced via `skippedReason`, but must not crash the dispatch — the
 * caller can still degrade to the standard scanned push). When an existing
 * pre-push hook is present that is NOT ours, we refuse to clobber it and report a
 * skip (a human-installed hook is respected; the gap is logged loudly).
 */
export async function installCePrePushSecretGuard(args: {
  worktreePath: string;
}): Promise<InstallCePrePushGuardResult> {
  const { worktreePath } = args;
  if (!worktreePath || !existsSync(worktreePath)) {
    return { installed: false, skippedReason: `worktree path does not exist: ${worktreePath}` };
  }
  const resolved = await resolveWorktreeHooksDir(worktreePath);
  if (!resolved) {
    return { installed: false, skippedReason: "worktree is not a git repository" };
  }
  const { gitDir, hooksDir } = resolved;
  const hookPath = join(hooksDir, "pre-push");
  const markerPath = join(gitDir, CE_PREPUSH_BLOCK_MARKER);
  const script = buildPrePushHookScript(markerPath);
  const OURS_MARKER = "fusion CE pre-push secret guard";

  try {
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf8");
      if (existing.includes(OURS_MARKER)) {
        // Re-write to keep it current (patterns may have changed across versions).
        writeFileSync(hookPath, script, { mode: 0o755 });
        chmodSync(hookPath, 0o755);
        return { installed: true, hookPath, gitDir };
      }
      // A foreign hook exists — do not clobber a human/tool-installed hook.
      return {
        installed: false,
        hookPath,
        gitDir,
        skippedReason: "a non-fusion pre-push hook already exists; not overwriting",
      };
    }
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, script, { mode: 0o755 });
    chmodSync(hookPath, 0o755);
    return { installed: true, hookPath, gitDir };
  } catch (err) {
    return {
      installed: false,
      gitDir,
      skippedReason: `failed to write pre-push hook: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Read + clear the block marker the hook writes when it aborts a push, returning
 * the recorded findings (for a persisted task-log audit entry). Returns null when
 * no block has occurred. Best-effort: a read/parse failure returns null.
 */
export function readCePrePushBlockMarker(
  gitDir: string,
): { blockedAt: string; findings: Array<{ path: string; kind: string; excerpt: string }> } | null {
  const markerPath = join(gitDir, CE_PREPUSH_BLOCK_MARKER);
  if (!existsSync(markerPath)) return null;
  let result: { blockedAt: string; findings: Array<{ path: string; kind: string; excerpt: string }> } | null =
    null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    if (parsed && Array.isArray(parsed.findings)) {
      result = { blockedAt: String(parsed.blockedAt ?? ""), findings: parsed.findings };
    }
  } catch {
    /* corrupt marker — treat as no usable block record */
  }
  // "Read + clear": once consumed, delete the marker so a re-read (e.g. the next
  // push audit) does not re-report a stale block. Best-effort — a failed unlink
  // never discards the parsed payload. We clear even on a corrupt/unparsable
  // marker so it cannot wedge subsequent reads.
  try {
    unlinkSync(markerPath);
  } catch {
    /* best-effort clear; ignore */
  }
  return result;
}
