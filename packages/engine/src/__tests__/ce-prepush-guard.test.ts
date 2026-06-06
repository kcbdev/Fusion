/**
 * Code-enforced pre-push secret guard (security issue #3).
 *
 * The CE PR-respond session is an untrusted AI with its own shell that can
 * `git push` directly, so the standard path's engine-owned `scanSecrets` does not
 * cover it. The enforceable chokepoint is a git pre-push hook installed in the task
 * worktree. These tests exercise the guard against a REAL fixture git repo:
 *   - install writes an executable, fusion-owned pre-push hook,
 *   - a seeded secret in the pushed range causes the actual `git push` to FAIL,
 *   - a clean push SUCCEEDS,
 *   - the hook's serialized patterns stay in parity with the standard-path scanner,
 *   - a foreign pre-push hook is never clobbered.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installCePrePushSecretGuard,
  buildPrePushHookScript,
  resolveWorktreeHooksDir,
  readCePrePushBlockMarker,
  CE_PREPUSH_BLOCK_MARKER,
} from "../ce-prepush-guard.js";
import { SECRET_PATTERNS, scanForSecrets } from "../pr-response-run.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Create a bare "origin" + a clone that pushes to it (a realistic push target). */
function makeRepoPair(): { origin: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), "ce-prepush-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--bare", origin], { encoding: "utf8" });
  execFileSync("git", ["clone", origin, work], { encoding: "utf8" });
  git(work, ["config", "user.email", "t@t.t"]);
  git(work, ["config", "user.name", "t"]);
  // Seed an initial commit + push so origin has a main branch to fast-forward.
  writeFileSync(join(work, "README.md"), "# seed\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-m", "seed"]);
  git(work, ["push", "origin", "HEAD:refs/heads/main"]);
  return { origin, work };
}

describe("CE pre-push secret guard (issue #3)", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  function track(work: string): void {
    // origin + work share the same tmp root parent; remove the root.
    dirs.push(join(work, ".."));
  }

  it("hook pattern set stays in parity with the standard-path scanner", () => {
    // The hook serializes SECRET_PATTERNS — assert the source script embeds each
    // pattern's source, so the git-side scan can never silently drift from the
    // engine-owned scanSecrets the standard pr-respond path uses.
    const script = buildPrePushHookScript("/tmp/marker.json");
    // The hook embeds the serialized [kind, source, flags] tuple array the builder
    // derives from SECRET_PATTERNS, then shell-single-quotes the whole program — so
    // the git-side scan can never drift from the engine-owned scanSecrets the
    // standard pr-respond path uses. Apply the same single-quote escaping to the
    // expected JSON before asserting containment.
    const expectedSerialized = JSON.stringify(
      SECRET_PATTERNS.map((p) => [p.kind, p.re.source, p.re.flags]),
    );
    const shellEscaped = expectedSerialized.replace(/'/g, "'\\''");
    expect(script).toContain(shellEscaped);
    for (const p of SECRET_PATTERNS) {
      expect(script).toContain(p.kind);
    }
    // Sanity: the representative AWS key the standard scanner flags is covered.
    expect(scanForSecrets([{ path: "x", content: "AKIAIOSFODNN7EXAMPLE" }])).toHaveLength(1);
  });

  it("installs an executable, fusion-owned pre-push hook", async () => {
    const { work } = makeRepoPair();
    track(work);
    const res = await installCePrePushSecretGuard({ worktreePath: work });
    expect(res.installed).toBe(true);
    expect(res.hookPath).toBeTruthy();
    expect(existsSync(res.hookPath!)).toBe(true);
    const body = readFileSync(res.hookPath!, "utf8");
    expect(body).toContain("fusion CE pre-push secret guard");
    // Executable bit set (owner-exec at minimum).
    expect(statSync(res.hookPath!).mode & 0o100).toBe(0o100);
  });

  it("blocks a real git push when a secret is in the pushed range", async () => {
    const { work } = makeRepoPair();
    track(work);
    await installCePrePushSecretGuard({ worktreePath: work });

    // Commit a credential (an AWS access key id the scanner flags).
    writeFileSync(join(work, "config.env"), "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n");
    git(work, ["add", "."]);
    git(work, ["commit", "-m", "add config"]);

    let pushFailed = false;
    try {
      git(work, ["push", "origin", "HEAD:refs/heads/main"]);
    } catch {
      pushFailed = true;
    }
    expect(pushFailed).toBe(true);

    // The block marker is written into the git dir with the finding for the audit.
    const resolved = await resolveWorktreeHooksDir(work);
    expect(resolved).not.toBeNull();
    const marker = readCePrePushBlockMarker(resolved!.gitDir);
    expect(marker).not.toBeNull();
    expect(marker!.findings.length).toBeGreaterThan(0);
    expect(marker!.findings[0].kind).toBe("aws-access-key-id");
    // The excerpt is redacted — the raw secret never lands in the audit.
    expect(JSON.stringify(marker)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    // "Read + clear": once consumed, the marker file is removed so a re-read does
    // not re-report a stale block. The first read returned the payload above.
    expect(existsSync(join(resolved!.gitDir, CE_PREPUSH_BLOCK_MARKER))).toBe(false);
    // A second read returns null (the marker was cleared).
    expect(readCePrePushBlockMarker(resolved!.gitDir)).toBeNull();
  });

  it("allows a clean push (no secrets)", async () => {
    const { work } = makeRepoPair();
    track(work);
    await installCePrePushSecretGuard({ worktreePath: work });

    writeFileSync(join(work, "feature.txt"), "const x = 1;\n");
    git(work, ["add", "."]);
    git(work, ["commit", "-m", "clean change"]);

    // Should NOT throw.
    expect(() => git(work, ["push", "origin", "HEAD:refs/heads/main"])).not.toThrow();
  });

  it("is idempotent: re-installing keeps the hook current and owned", async () => {
    const { work } = makeRepoPair();
    track(work);
    const first = await installCePrePushSecretGuard({ worktreePath: work });
    const second = await installCePrePushSecretGuard({ worktreePath: work });
    expect(first.installed).toBe(true);
    expect(second.installed).toBe(true);
    expect(second.hookPath).toBe(first.hookPath);
  });

  it("refuses to clobber a foreign pre-push hook", async () => {
    const { work } = makeRepoPair();
    track(work);
    const resolved = await resolveWorktreeHooksDir(work);
    expect(resolved).not.toBeNull();
    await mkdir(resolved!.hooksDir, { recursive: true });
    const foreign = join(resolved!.hooksDir, "pre-push");
    writeFileSync(foreign, "#!/bin/sh\n# someone else's hook\nexit 0\n", { mode: 0o755 });

    const res = await installCePrePushSecretGuard({ worktreePath: work });
    expect(res.installed).toBe(false);
    expect(res.skippedReason).toMatch(/non-fusion/i);
    // The foreign hook is untouched.
    expect(readFileSync(foreign, "utf8")).toContain("someone else's hook");
  });

  it("reports a non-git worktree as skipped (never throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ce-prepush-nogit-"));
    dirs.push(dir);
    const res = await installCePrePushSecretGuard({ worktreePath: dir });
    expect(res.installed).toBe(false);
    expect(res.skippedReason).toMatch(/not a git repository/i);
  });
});
