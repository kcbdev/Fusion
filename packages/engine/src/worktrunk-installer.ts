import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { WorktrunkSettings } from "@fusion/core";
import { createLogger } from "./logger.js";
import type { EngineRunContext, RunAuditor } from "./run-audit.js";

const execAsync = promisify(exec);
const logger = createLogger("worktrunk-installer");

export const WORKTRUNK_PROBE_TIMEOUT_MS = 10_000;
export const WORKTRUNK_DOWNLOAD_TIMEOUT_MS = 60_000;
export const WORKTRUNK_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const WORKTRUNK_CARGO_TIMEOUT_MS = 10 * 60_000;
export const WORKTRUNK_INSTALL_DIR = path.join(os.homedir(), ".fusion", "bin");
export const WORKTRUNK_INSTALL_PATH = path.join(WORKTRUNK_INSTALL_DIR, "worktrunk");

const AUTO_INSTALL_DISABLED_MESSAGE =
  "worktrunk auto-install path disabled; set worktrunk.binaryPath or install worktrunk on PATH";

export class WorktrunkBinaryUnavailableError extends Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WorktrunkBinaryUnavailableError";
    if (details) Object.assign(this, details);
  }
}

export class WorktrunkInstallDeniedError extends Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WorktrunkInstallDeniedError";
    if (details) Object.assign(this, details);
  }
}

export class WorktrunkInstallFailedError extends Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WorktrunkInstallFailedError";
    if (details) Object.assign(this, details);
  }
}

const resolveCache = new Map<string, { inputBinaryPath: string | null; path: string; resolvedAt: number }>();

function homeKey(settings: WorktrunkSettings): string {
  return `${os.homedir()}::${settings.binaryPath ?? ""}`;
}

async function emitBinaryAudit(
  auditor: RunAuditor | undefined,
  type: "binary:install-requested" | "binary:install-success" | "binary:install-failed" | "binary:install-denied",
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!auditor) return;
  await auditor.filesystem({ type, target: WORKTRUNK_INSTALL_PATH, metadata });
}

async function lookupPath(binaryName: string): Promise<string | null> {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execAsync(`${command} ${binaryName}`, {
      timeout: WORKTRUNK_PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export async function probeWorktrunk(binaryPath: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execAsync(`"${binaryPath}" --version`, {
      timeout: WORKTRUNK_PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const version = stdout.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1];
    return { ok: true, ...(version ? { version } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveWorktrunkBinary(opts: {
  settings: WorktrunkSettings;
  auditor?: RunAuditor;
  runContext?: EngineRunContext;
}): Promise<{ binaryPath: string; source: "override" | "path" | "cached" }> {
  const { settings } = opts;
  const key = homeKey(settings);
  const cached = resolveCache.get(key);
  if (cached && cached.inputBinaryPath === (settings.binaryPath ?? null)) {
    const probe = await probeWorktrunk(cached.path);
    if (probe.ok) return { binaryPath: cached.path, source: "cached" };
  }

  logger.log("resolve: checking override");
  if (settings.binaryPath) {
    const probe = await probeWorktrunk(settings.binaryPath);
    if (probe.ok) return { binaryPath: settings.binaryPath, source: "override" };
  }

  logger.log("resolve: checking PATH");
  const onPath = await lookupPath("worktrunk");
  if (onPath) {
    const probe = await probeWorktrunk(onPath);
    if (probe.ok) return { binaryPath: onPath, source: "path" };
  }

  logger.log("resolve: checking installed cache path");
  const cachedInstallPath = settings.installedBinaryPath ?? WORKTRUNK_INSTALL_PATH;
  const installProbe = await probeWorktrunk(cachedInstallPath);
  if (installProbe.ok) return { binaryPath: cachedInstallPath, source: "cached" };

  logger.log("resolve: install path disabled; failing");
  await installWorktrunk(opts);
}

export async function installWorktrunk(opts: {
  settings: WorktrunkSettings;
  auditor?: RunAuditor;
  runContext?: EngineRunContext;
}): Promise<never> {
  await emitBinaryAudit(opts.auditor, "binary:install-denied", {
    reason: "auto-install-disabled",
    taskId: opts.runContext?.taskId,
    runId: opts.runContext?.runId,
  });
  throw new WorktrunkInstallFailedError(AUTO_INSTALL_DISABLED_MESSAGE, { stage: "auto-install-disabled" });
}

export function clearWorktrunkResolveCache(): void {
  resolveCache.clear();
}
