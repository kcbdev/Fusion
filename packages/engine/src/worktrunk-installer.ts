import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { WorktrunkSettings } from "@fusion/core";
import type { AgentActionGateContext } from "./agent-action-gate.js";
import type { EngineRunContext, RunAuditor } from "./run-audit.js";
import { createLogger } from "./logger.js";

const execAsync = promisify(exec);
const logger = createLogger("worktrunk-installer");

export const WORKTRUNK_PINNED_RELEASE = {
  version: "0.4.2",
  assets: {
    "darwin-arm64": {
      url: "https://github.com/cognitive-engineering-lab/worktrunk/releases/download/v0.4.2/worktrunk-darwin-arm64.tar.gz",
      sha256: "",
      archiveName: "worktrunk-darwin-arm64.tar.gz",
      innerBinaryName: "worktrunk",
    },
    "darwin-x64": {
      url: "https://github.com/cognitive-engineering-lab/worktrunk/releases/download/v0.4.2/worktrunk-darwin-x64.tar.gz",
      sha256: "",
      archiveName: "worktrunk-darwin-x64.tar.gz",
      innerBinaryName: "worktrunk",
    },
    "linux-x64": {
      url: "https://github.com/cognitive-engineering-lab/worktrunk/releases/download/v0.4.2/worktrunk-linux-x64.tar.gz",
      sha256: "",
      archiveName: "worktrunk-linux-x64.tar.gz",
      innerBinaryName: "worktrunk",
    },
    "linux-arm64": {
      url: "https://github.com/cognitive-engineering-lab/worktrunk/releases/download/v0.4.2/worktrunk-linux-arm64.tar.gz",
      sha256: "",
      archiveName: "worktrunk-linux-arm64.tar.gz",
      innerBinaryName: "worktrunk",
    },
  },
} as const;

export const WORKTRUNK_PROBE_TIMEOUT_MS = 10_000;
export const WORKTRUNK_DOWNLOAD_TIMEOUT_MS = 60_000;
export const WORKTRUNK_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const WORKTRUNK_CARGO_TIMEOUT_MS = 10 * 60_000;
export const WORKTRUNK_INSTALL_DIR = path.join(os.homedir(), ".fusion", "bin");
export const WORKTRUNK_INSTALL_PATH = path.join(WORKTRUNK_INSTALL_DIR, "worktrunk");

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

function getHomeKey(settings: WorktrunkSettings): string {
  return `${os.homedir()}::${settings.binaryPath ?? ""}`;
}

async function probePathLookup(command: "which" | "where"): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${command} worktrunk`, {
      timeout: WORKTRUNK_PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return candidate || null;
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
    const match = stdout.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
    return { ok: true, ...(match?.[1] ? { version: match[1] } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveWorktrunkBinary(opts: {
  settings: WorktrunkSettings;
  actionGateContext?: AgentActionGateContext;
  auditor?: RunAuditor;
  runContext?: EngineRunContext;
}): Promise<{ binaryPath: string; source: "override" | "path" | "cached" | "installed-release" | "installed-cargo" }> {
  const { settings } = opts;
  const cacheKey = getHomeKey(settings);
  const cached = resolveCache.get(cacheKey);
  if (cached && cached.inputBinaryPath === (settings.binaryPath ?? null)) {
    const probe = await probeWorktrunk(cached.path);
    if (probe.ok) {
      return { binaryPath: cached.path, source: "cached" };
    }
  }

  logger.log("resolving worktrunk binary");

  if (settings.binaryPath) {
    const overrideProbe = await probeWorktrunk(settings.binaryPath);
    if (overrideProbe.ok) {
      resolveCache.set(cacheKey, {
        inputBinaryPath: settings.binaryPath,
        path: settings.binaryPath,
        resolvedAt: Date.now(),
      });
      return { binaryPath: settings.binaryPath, source: "override" };
    }
  }

  const pathProbe = await probePathLookup(process.platform === "win32" ? "where" : "which");
  if (pathProbe) {
    const result = await probeWorktrunk(pathProbe);
    if (result.ok) {
      resolveCache.set(cacheKey, {
        inputBinaryPath: settings.binaryPath ?? null,
        path: pathProbe,
        resolvedAt: Date.now(),
      });
      return { binaryPath: pathProbe, source: "path" };
    }
  }

  const cachedInstallProbe = await probeWorktrunk(WORKTRUNK_INSTALL_PATH);
  if (cachedInstallProbe.ok) {
    resolveCache.set(cacheKey, {
      inputBinaryPath: settings.binaryPath ?? null,
      path: WORKTRUNK_INSTALL_PATH,
      resolvedAt: Date.now(),
    });
    return { binaryPath: WORKTRUNK_INSTALL_PATH, source: "cached" };
  }

  const installed = await installWorktrunk(opts);
  resolveCache.set(cacheKey, {
    inputBinaryPath: settings.binaryPath ?? null,
    path: installed.binaryPath,
    resolvedAt: Date.now(),
  });
  return installed;
}

export async function installWorktrunk(_opts: {
  settings: WorktrunkSettings;
  actionGateContext?: AgentActionGateContext;
  auditor?: RunAuditor;
  runContext?: EngineRunContext;
}): Promise<{ binaryPath: string; source: "installed-release" | "installed-cargo" }> {
  throw new WorktrunkInstallFailedError("worktrunk auto-install is not implemented", {
    stage: "not-implemented",
    attempted: ["release", "cargo"],
  });
}

export function clearWorktrunkResolveCache(): void {
  resolveCache.clear();
}
