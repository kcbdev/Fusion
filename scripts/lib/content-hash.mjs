/**
 * Shared content-hashing helpers for the inner-loop overhead caches (U3).
 *
 * The goal is a hash that:
 *   - Is cheap to compute (defers to git's already-computed blob SHAs).
 *   - Is branch-switch stable: restoring identical content under a different
 *     branch yields the same hash, so we don't re-run work that already passed.
 *   - Still busts on real content changes, INCLUDING unstaged/working-tree edits
 *     and untracked files (git ls-files -s only sees the index, not the working
 *     tree). For those "dirty" files we hash the working-tree bytes directly.
 *
 * Correctness-over-speed: when a tracked file is modified in the working tree we
 * read and hash its actual bytes rather than trusting the (now stale) index blob
 * SHA. Untracked-but-not-ignored files are likewise read and hashed. Only when a
 * path is fully clean do we lean on git's blob SHA without touching the file.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Default git runner. Returns trimmed stdout on success, null on failure.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string|null}
 */
export function defaultGitRunner(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

/**
 * Parse `git ls-files -s <paths...>` output into { filePath, blobSha } records.
 *
 * @param {string|null} lsOut
 * @returns {{ filePath: string, blobSha: string }[]}
 */
function parseLsFiles(lsOut) {
  const entries = [];
  if (!lsOut) return entries;
  for (const line of lsOut.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: <mode> SP <object> SP <stage> TAB <file>
    const tabIdx = trimmed.indexOf("\t");
    if (tabIdx === -1) continue;
    const fields = trimmed.slice(0, tabIdx).split(/\s+/);
    const blobSha = fields[1] ?? "";
    const filePath = trimmed.slice(tabIdx + 1);
    entries.push({ filePath, blobSha });
  }
  return entries;
}

/**
 * Compute a content hash over the given repo-relative input paths.
 *
 * Each path may be a file or a directory; git expands directories to their
 * tracked files. Dirty (modified-tracked) and untracked-not-ignored files have
 * their working-tree bytes hashed so the hash reflects real on-disk content,
 * never a stale index blob SHA.
 *
 * @param {object} options
 * @param {string} options.rootDir          Repo root (cwd for git).
 * @param {string[]} options.inputPaths     Repo-relative files/dirs to hash.
 * @param {string} [options.versionPrefix]  Constant mixed in to bust on format change.
 * @param {(args: string[], cwd: string) => string|null} [options.gitFn]  Injectable git.
 * @param {(absPath: string) => Buffer|string} [options.readFn]  Injectable file reader.
 * @returns {string} 64-char hex SHA-256.
 */
export function computeContentHash({
  rootDir,
  inputPaths,
  versionPrefix = "ch-v1",
  gitFn = defaultGitRunner,
  readFn = (absPath) => readFileSync(absPath),
}) {
  const hash = createHash("sha256");
  hash.update(versionPrefix);
  hash.update("\0");

  // Tracked files (index blob SHAs) for every input path.
  const tracked = parseLsFiles(gitFn(["ls-files", "-s", "--", ...inputPaths], rootDir));
  const trackedByPath = new Map(tracked.map((entry) => [entry.filePath, entry.blobSha]));

  // Working-tree status: which tracked files are modified, which are untracked.
  // `git status --porcelain -uall -- <paths>` reports both. Untracked entries
  // are prefixed with `??`; modified-tracked with ` M`/`M `/etc.
  const dirtyPaths = new Set();
  const untrackedPaths = new Set();
  const statusOut = gitFn(["status", "--porcelain", "-uall", "--", ...inputPaths], rootDir);
  if (statusOut) {
    for (const rawLine of statusOut.split("\n")) {
      if (!rawLine) continue;
      // Porcelain v1 lines are "XY PATH" where XY is the 2-char status code.
      // Rather than slice a fixed column (git's exact spacing varies subtly by
      // staged/worktree state), take the first 2 chars as the code and trim the
      // remainder for the path.
      const code = rawLine.slice(0, 2);
      let file = rawLine.slice(2).replace(/^\s+/, "");
      // Renames show "old -> new"; hash the new path.
      const arrowIdx = file.indexOf(" -> ");
      if (arrowIdx !== -1) file = file.slice(arrowIdx + 4);
      // Strip optional surrounding quotes git adds for unusual filenames.
      file = file.replace(/^"|"$/g, "");
      if (code === "??") {
        untrackedPaths.add(file);
      } else {
        dirtyPaths.add(file);
      }
    }
  }

  // Build the full path list: every tracked file plus every untracked file.
  const allPaths = new Set([...trackedByPath.keys(), ...untrackedPaths]);
  const sorted = [...allPaths].sort((a, b) => a.localeCompare(b));

  for (const filePath of sorted) {
    hash.update(filePath);
    hash.update("=");
    const isDirty = dirtyPaths.has(filePath) || untrackedPaths.has(filePath);
    if (isDirty) {
      // Hash real on-disk bytes — index blob SHA is stale or absent.
      try {
        const bytes = readFn(path.join(rootDir, filePath));
        const fileHash = createHash("sha256").update(bytes).digest("hex");
        hash.update("dirty:");
        hash.update(fileHash);
      } catch {
        // File vanished mid-scan (transient). Mix in a marker so the hash
        // differs from the clean case and forces a re-run.
        hash.update("dirty:missing");
      }
    } else {
      hash.update(trackedByPath.get(filePath) ?? "");
    }
    hash.update("\0");
  }

  return hash.digest("hex");
}

/**
 * Read a JSON cache file, returning a fallback on any failure.
 *
 * @param {string} filePath
 * @param {unknown} fallback
 * @returns {unknown}
 */
export function readJsonCache(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Resolve the shared fusion cache directory (same dir as test-cache.json).
 *
 * @param {string} rootDir
 * @returns {string}
 */
export function fusionCacheDir(rootDir) {
  return path.join(rootDir, "node_modules", ".cache", "fusion");
}

/** Re-export statSync passthrough so callers can stub uniformly if needed. */
export { statSync };
