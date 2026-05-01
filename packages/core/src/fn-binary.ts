/**
 * Resolve how to invoke the Fusion CLI from server-side code (automations,
 * generated commands, docs snippets).
 *
 * Order of preference:
 *   1. `fn`      — short canonical name
 *   2. `fusion`  — long alias name
 *   3. `npx -y runfusion.ai` — zero-install fallback that always works
 *
 * The npm bin name on disk varies by install path and platform; the version
 * is read by spawning `<bin> --version` so we report the actually-runnable
 * binary, not just the first match on PATH.
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

interface ProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a command with an explicit argv (no shell) and capture stdout/stderr.
 * Always resolves; on spawn failure exitCode is null and stderr carries the
 * error message. Used here for safe, dependency-free PATH lookups and
 * version probes — do not use for general command execution.
 */
function runProbe(command: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr || err.message });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/** npm package that publishes the `fn`/`fusion` bins. Used for npx fallback. */
export const FN_NPM_PACKAGE = "runfusion.ai";

/** Recommended one-line installer URL surfaced in UI/docs. */
export const FN_INSTALL_CURL = "curl -fsSL https://runfusion.ai/install.sh | sh";

/** Recommended npm install command surfaced in UI/docs. */
export const FN_INSTALL_NPM = `npm install -g ${FN_NPM_PACKAGE}`;

/** Zero-install invocation prefix used when no global binary is present. */
export const FN_NPX_INVOCATION = `npx -y ${FN_NPM_PACKAGE}`;

/** Candidate binary names checked, in preference order. */
const CANDIDATES = ["fn", "fusion"] as const;

export type FnBinaryName = (typeof CANDIDATES)[number];

export interface FnBinaryStatus {
  /** True if a working `fn` or `fusion` binary was found on PATH. */
  installed: boolean;
  /** Which binary name resolved, if any. */
  binary?: FnBinaryName;
  /** Absolute path to the resolved binary, when available. */
  path?: string;
  /** Version reported by `<bin> --version`, when available. */
  version?: string;
  /**
   * Command prefix to use when scripting against the CLI. This is either
   * the binary name itself (when installed) or {@link FN_NPX_INVOCATION}.
   */
  invocation: string;
}

/**
 * Look up an executable on PATH using the platform-appropriate command.
 * Returns the first absolute path or undefined.
 */
async function whichBinary(name: string): Promise<string | undefined> {
  const isWindows = platform() === "win32";
  const lookup = isWindows ? "where" : "which";
  const result = await runProbe(lookup, [name], 5_000);
  if (result.exitCode !== 0) return undefined;
  const firstLine = result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return firstLine || undefined;
}

/**
 * Best-effort version probe. Returns undefined if the binary refuses the
 * flag or produces no parseable output — the caller should treat undefined
 * as "installed but version unknown" rather than "not installed".
 */
async function probeVersion(binary: string): Promise<string | undefined> {
  const result = await runProbe(binary, ["--version"], 10_000);
  if (result.exitCode !== 0) return undefined;
  const text = (result.stdout || result.stderr).trim();
  if (!text) return undefined;
  // Match the first semver-ish token so we strip prefixes like "fn v0.13.0".
  const match = text.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/);
  return match ? match[0] : text.split(/\s+/)[0];
}

/**
 * Detect whether the `fn` (or `fusion`) CLI is installed on PATH and
 * return the recommended invocation prefix.
 *
 * Never throws — on any error it falls through to the npx fallback so
 * callers can rely on `invocation` always being usable.
 */
export async function detectFnBinary(): Promise<FnBinaryStatus> {
  for (const candidate of CANDIDATES) {
    try {
      const resolvedPath = await whichBinary(candidate);
      if (!resolvedPath) continue;
      const version = await probeVersion(candidate);
      return {
        installed: true,
        binary: candidate,
        path: resolvedPath,
        version,
        invocation: candidate,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    installed: false,
    invocation: FN_NPX_INVOCATION,
  };
}
