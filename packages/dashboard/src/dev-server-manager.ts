import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export interface DevServerState {
  id: string;
  name: string;
  status: "stopped" | "starting" | "running" | "failed";
  command: string;
  scriptName: string;
  cwd: string;
  pid?: number;
  startedAt?: string;
  previewUrl?: string;
  detectedPort?: number;
  manualPreviewUrl?: string;
  logs: string[];
  exitCode?: number | null;
}

interface PersistedDevServerState {
  id: string;
  name: string;
  command: string;
  scriptName: string;
  cwd: string;
  pid?: number;
  startedAt?: string;
  manualPreviewUrl?: string;
  exitCode?: number | null;
}

export const MAX_LOG_LINES = 500;
export const FALLBACK_PORTS = [3000, 4173, 5173, 6006, 8080, 4200, 4400, 8888] as const;

function createDefaultState(projectRoot: string): DevServerState {
  return {
    id: "default",
    name: "default",
    status: "stopped",
    command: "",
    scriptName: "",
    cwd: projectRoot,
    logs: [],
    exitCode: null,
  };
}

function normalizeUrl(host: string, port: number): string {
  const normalizedHost = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host;
  return `http://${normalizedHost}:${port}`;
}

export function parseLineForUrl(line: string): { url: string; port: number } | null {
  const patterns: RegExp[] = [
    /(?:Local|local|ready on|listening on|started on|running at)\s*(?:http:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
    /http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;

    if (match.length === 3) {
      const [, host, rawPort] = match;
      const port = Number.parseInt(rawPort, 10);
      if (!Number.isFinite(port)) return null;
      return { url: normalizeUrl(host, port), port };
    }

    if (match.length === 2) {
      const [, rawPort] = match;
      const port = Number.parseInt(rawPort, 10);
      if (!Number.isFinite(port)) return null;
      return { url: normalizeUrl("localhost", port), port };
    }
  }

  return null;
}

export class DevServerManager extends EventEmitter {
  private readonly stateFile: string;
  private readonly servers = new Map<string, DevServerState>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly killTimers = new Map<string, NodeJS.Timeout>();
  private portProbeTimer: NodeJS.Timeout | null = null;
  private readonly loadPromise: Promise<void>;

  constructor(private readonly projectRoot: string) {
    super();
    this.stateFile = path.join(this.projectRoot, ".fusion", "dev-server.json");
    this.servers.set("default", createDefaultState(this.projectRoot));
    this.loadPromise = this.loadState();
  }

  async start(command: string, scriptName: string, cwd?: string): Promise<DevServerState> {
    await this.loadPromise;

    const current = this.getMutableState();
    if (current.status !== "stopped") {
      throw new Error(`Dev server is already ${current.status}`);
    }

    const resolvedCwd = cwd ? path.resolve(cwd) : this.projectRoot;
    const startedAt = new Date().toISOString();
    const nextState: DevServerState = {
      ...current,
      id: "default",
      name: "default",
      status: "starting",
      command,
      scriptName,
      cwd: resolvedCwd,
      pid: undefined,
      startedAt,
      previewUrl: current.manualPreviewUrl,
      detectedPort: undefined,
      logs: [],
      exitCode: null,
    };

    this.servers.set("default", nextState);
    this.emit("status", this.cloneState(nextState));

    const child = spawn(command, [], {
      cwd: resolvedCwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        TERM: "xterm-256color",
      },
    });

    if (child.pid) {
      nextState.pid = child.pid;
    }

    this.processes.set("default", child);

    const onOutput = (chunk: Buffer, markRunning: boolean): void => {
      const lines = chunk
        .toString("utf-8")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

      for (const line of lines) {
        const state = this.getMutableState();
        this.pushLogLine(state, line);

        if (markRunning && state.status === "starting") {
          state.status = "running";
          this.emit("status", this.cloneState(state));

          if (!state.previewUrl) {
            this.scheduleFallbackPortProbe();
          }
        }

        this.tryParseAndApplyUrl(line);
        this.emit("log", { serverId: "default", line });
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      onOutput(data, true);
    });

    child.stderr?.on("data", (data: Buffer) => {
      onOutput(data, false);
    });

    child.on("exit", (code: number | null) => {
      const state = this.getMutableState();
      state.status = code === 0 ? "stopped" : "failed";
      state.exitCode = code;
      state.pid = undefined;

      this.processes.delete("default");
      this.clearKillTimer("default");
      this.clearPortProbeTimer();

      if (state.manualPreviewUrl) {
        state.previewUrl = state.manualPreviewUrl;
      }

      this.emit("status", this.cloneState(state));
      this.persistState();
    });

    child.on("error", (err: Error) => {
      const state = this.getMutableState();
      state.status = "failed";
      state.exitCode = 1;
      state.pid = undefined;
      this.pushLogLine(state, `[dev-server] ${err.message}`);

      this.processes.delete("default");
      this.clearKillTimer("default");
      this.clearPortProbeTimer();

      this.emit("status", this.cloneState(state));
      this.persistState();
    });

    this.persistState();
    return this.getState();
  }

  async stop(): Promise<DevServerState> {
    await this.loadPromise;

    const state = this.getMutableState();
    const child = this.processes.get("default");
    if (!child || (state.status !== "running" && state.status !== "starting")) {
      return this.getState();
    }

    state.status = "stopped";
    this.emit("status", this.cloneState(state));

    child.kill("SIGTERM");

    const killTimer = setTimeout(() => {
      if (!this.processes.has("default")) {
        return;
      }

      const processToKill = this.processes.get("default");
      processToKill?.kill("SIGKILL");
    }, 5_000);
    this.killTimers.set("default", killTimer);

    this.clearPortProbeTimer();
    this.persistState();
    return this.getState();
  }

  async restart(): Promise<DevServerState> {
    await this.loadPromise;

    const state = this.getMutableState();
    const command = state.command;
    const scriptName = state.scriptName;
    const cwd = state.cwd;

    if (!command || !scriptName) {
      throw new Error("Cannot restart dev server before it has been started once");
    }

    if (state.status !== "stopped" && state.status !== "failed") {
      await this.stop();
      await this.waitForProcessExit("default", 5_500);
    }

    return this.start(command, scriptName, cwd);
  }

  getState(): DevServerState {
    const state = this.servers.get("default");
    if (!state) {
      return createDefaultState(this.projectRoot);
    }
    return this.cloneState(state);
  }

  getAllStates(): DevServerState[] {
    return Array.from(this.servers.values()).map((state) => this.cloneState(state));
  }

  getLogs(tail?: number): string[] {
    const logs = this.getMutableState().logs;
    if (tail === undefined || tail <= 0 || tail >= logs.length) {
      return [...logs];
    }
    return logs.slice(-tail);
  }

  setManualPreviewUrl(url: string | null): DevServerState {
    const state = this.getMutableState();
    state.manualPreviewUrl = url ?? undefined;

    if (url) {
      state.previewUrl = url;
    } else if (state.detectedPort) {
      state.previewUrl = normalizeUrl("localhost", state.detectedPort);
    } else {
      state.previewUrl = undefined;
    }

    this.emit("status", this.cloneState(state));
    this.persistState();
    return this.getState();
  }

  destroy(): void {
    for (const [serverId, child] of this.processes.entries()) {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (!this.processes.has(serverId)) {
          return;
        }
        this.processes.get(serverId)?.kill("SIGKILL");
      }, 5_000);
      this.killTimers.set(serverId, killTimer);
    }

    for (const timer of this.killTimers.values()) {
      clearTimeout(timer);
    }
    this.killTimers.clear();

    this.clearPortProbeTimer();
    this.removeAllListeners();
    this.processes.clear();
    this.servers.clear();
  }

  private getMutableState(): DevServerState {
    const state = this.servers.get("default");
    if (state) {
      return state;
    }

    const fallback = createDefaultState(this.projectRoot);
    this.servers.set("default", fallback);
    return fallback;
  }

  private cloneState(state: DevServerState): DevServerState {
    return {
      ...state,
      logs: [...state.logs],
    };
  }

  private tryParseAndApplyUrl(line: string): void {
    const parsed = parseLineForUrl(line);
    if (!parsed) {
      return;
    }

    const state = this.getMutableState();
    state.detectedPort = parsed.port;
    if (!state.manualPreviewUrl) {
      state.previewUrl = parsed.url;
    }

    this.emit("url-detected", { serverId: "default", url: parsed.url, port: parsed.port });
    this.clearPortProbeTimer();
    this.emit("status", this.cloneState(state));
    this.persistState();
  }

  private scheduleFallbackPortProbe(): void {
    this.clearPortProbeTimer();
    this.portProbeTimer = setTimeout(() => {
      this.probeFallbackPorts();
    }, 10_000);
  }

  private probeFallbackPorts(): void {
    void (async () => {
      for (const port of FALLBACK_PORTS) {
        const available = await this.testPort(port);
        if (!available) {
          continue;
        }

        const state = this.getMutableState();
        state.detectedPort = port;
        if (!state.manualPreviewUrl) {
          state.previewUrl = normalizeUrl("localhost", port);
        }

        this.emit("url-detected", { serverId: "default", url: normalizeUrl("localhost", port), port });
        this.emit("status", this.cloneState(state));
        this.persistState();
        return;
      }
    })();
  }

  private async testPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host: "localhost" });

      const complete = (result: boolean): void => {
        socket.removeAllListeners();
        if (!socket.destroyed) {
          socket.destroy();
        }
        resolve(result);
      };

      socket.setTimeout(500);
      socket.once("connect", () => complete(true));
      socket.once("timeout", () => complete(false));
      socket.once("error", () => complete(false));
    });
  }

  private clearPortProbeTimer(): void {
    if (!this.portProbeTimer) {
      return;
    }

    clearTimeout(this.portProbeTimer);
    this.portProbeTimer = null;
  }

  private clearKillTimer(serverId: string): void {
    const timer = this.killTimers.get(serverId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.killTimers.delete(serverId);
  }

  private pushLogLine(state: DevServerState, line: string): void {
    state.logs.push(line);
    if (state.logs.length > MAX_LOG_LINES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
    }
  }

  private async waitForProcessExit(serverId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (this.processes.has(serverId) && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private persistState(): void {
    const state = this.getMutableState();
    const payload: PersistedDevServerState = {
      id: state.id,
      name: state.name,
      command: state.command,
      scriptName: state.scriptName,
      cwd: state.cwd,
      manualPreviewUrl: state.manualPreviewUrl,
      exitCode: state.exitCode,
      pid: state.pid,
      startedAt: state.startedAt,
    };

    void (async () => {
      try {
        await mkdir(path.dirname(this.stateFile), { recursive: true });
        await writeFile(this.stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
      } catch (err) {
        console.error("[dev-server] Failed to persist state:", err);
      }
    })();
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.stateFile, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedDevServerState>;
      const state = this.getMutableState();

      state.command = typeof parsed.command === "string" ? parsed.command : "";
      state.scriptName = typeof parsed.scriptName === "string" ? parsed.scriptName : "";
      state.cwd = typeof parsed.cwd === "string" ? parsed.cwd : this.projectRoot;
      state.manualPreviewUrl = typeof parsed.manualPreviewUrl === "string" ? parsed.manualPreviewUrl : undefined;
      state.previewUrl = state.manualPreviewUrl;
      state.startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : undefined;
      state.exitCode = parsed.exitCode ?? null;

      const maybePid = typeof parsed.pid === "number" ? parsed.pid : undefined;
      if (maybePid === undefined) {
        state.status = "stopped";
        state.pid = undefined;
        return;
      }

      try {
        process.kill(maybePid, 0);
        state.status = "running";
        state.pid = maybePid;
      } catch {
        state.status = "stopped";
        state.pid = undefined;
      }
    } catch {
      this.servers.set("default", createDefaultState(this.projectRoot));
    }
  }
}

const managers: Map<string, DevServerManager> = new Map();

export function getDevServerManager(projectRoot: string): DevServerManager {
  const resolvedRoot = path.resolve(projectRoot);
  const existing = managers.get(resolvedRoot);
  if (existing) {
    return existing;
  }

  const manager = new DevServerManager(resolvedRoot);
  managers.set(resolvedRoot, manager);
  return manager;
}

export function destroyAllDevServerManagers(): void {
  for (const manager of managers.values()) {
    manager.destroy();
  }
  managers.clear();
}
