/**
 * CLI binary management routes.
 *
 *   GET  /system/fn-binary/status   — does the user have `fn`/`fusion` on PATH?
 *   POST /system/fn-binary/install  — run `npm install -g runfusion.ai`
 *
 * Used by the Settings → General → CLI Binary panel and the first-launch
 * banner. Install routes are intentionally synchronous-with-result rather
 * than streaming; npm global installs are short enough that polling for
 * completion isn't worth a websocket channel.
 */

import { spawn } from "node:child_process";
import {
  detectFnBinary,
  FN_INSTALL_CURL,
  FN_INSTALL_NPM,
  FN_NPM_PACKAGE,
  type FnBinaryStatus,
} from "@fusion/core";
import { ApiError } from "../api-error.js";
import { getCliPackageVersion } from "../cli-package-version.js";
import type { ApiRouteRegistrar } from "./types.js";

/** Hard cap on `npm install -g` runtime. */
const INSTALL_TIMEOUT_MS = 180_000;
/** Hard cap on captured npm output to keep responses small. */
const MAX_OUTPUT_BYTES = 64 * 1024;

interface InstallResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  durationMs: number;
  /** Hint surfaced to the UI when EACCES is detected. */
  permissionsHint?: string;
}

/**
 * Compose the status payload returned by GET /system/fn-binary/status.
 * Includes the expected version (read from this package's package.json),
 * the canonical install commands, and a derived state for the UI.
 */
function buildStatusPayload(binary: FnBinaryStatus, expectedVersion: string) {
  let state: "installed" | "missing" | "version-mismatch" = "missing";
  if (binary.installed) {
    state = binary.version && binary.version !== expectedVersion
      ? "version-mismatch"
      : "installed";
  }
  return {
    binary,
    expectedVersion,
    state,
    install: {
      npm: FN_INSTALL_NPM,
      curl: FN_INSTALL_CURL,
      package: FN_NPM_PACKAGE,
    },
  };
}

/**
 * Run `npm install -g runfusion.ai`, capturing output up to MAX_OUTPUT_BYTES
 * and timing out after INSTALL_TIMEOUT_MS. Always resolves; never rejects.
 */
function runNpmInstall(): Promise<InstallResult> {
  const startedAt = Date.now();
  const command = FN_INSTALL_NPM;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn("npm", ["install", "-g", FN_NPM_PACKAGE], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, INSTALL_TIMEOUT_MS);

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += text.slice(0, MAX_OUTPUT_BYTES - stdout.length);
        }
      } else {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += text.slice(0, MAX_OUTPUT_BYTES - stderr.length);
        }
      }
    };
    child.stdout?.on("data", (c: Buffer) => append("stdout", c));
    child.stderr?.on("data", (c: Buffer) => append("stderr", c));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr: stderr || err.message,
        command,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const eaccesHit = /EACCES|permission denied|Operation not permitted/i.test(combined);
      const success = exitCode === 0 && !timedOut;
      resolve({
        success,
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\n[install timed out after ${INSTALL_TIMEOUT_MS / 1000}s]` : stderr,
        command,
        durationMs: Date.now() - startedAt,
        permissionsHint: !success && eaccesHit
          ? "npm reported a permissions error. On macOS/Linux this usually means npm's global prefix needs `sudo` or a fix to your npm prefix (https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)."
          : undefined,
      });
    });
  });
}

export const registerFnBinaryRoutes: ApiRouteRegistrar = (ctx) => {
  const { router, rethrowAsApiError } = ctx;

  /**
   * GET /system/fn-binary/status
   *
   * Probes PATH for `fn` then `fusion`, returning install state and the
   * canonical install commands. No auth — this is read-only introspection
   * the dashboard banner needs before the user signs in.
   */
  router.get("/system/fn-binary/status", async (_req, res) => {
    try {
      const binary = await detectFnBinary();
      const expectedVersion = getCliPackageVersion();
      res.json(buildStatusPayload(binary, expectedVersion));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  /**
   * POST /system/fn-binary/install
   *
   * Runs `npm install -g runfusion.ai`. Returns the install result and the
   * post-install probe so the UI can refresh its state in one round trip.
   */
  router.post("/system/fn-binary/install", async (_req, res) => {
    try {
      const installResult = await runNpmInstall();
      // Re-probe even on failure — the binary may already exist from a
      // previous attempt and we want the UI to reflect reality.
      const binary = await detectFnBinary();
      const expectedVersion = getCliPackageVersion();
      const status = buildStatusPayload(binary, expectedVersion);
      res.json({ ...status, installResult });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });
};
