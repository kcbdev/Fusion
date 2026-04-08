import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CentralCore } from "@fusion/core";
import { ChildProcessRuntime } from "./child-process-runtime.js";
import { IpcHost } from "../ipc/ipc-host.js";
import type { ProjectRuntimeConfig } from "../project-runtime.js";

type MockChildProcess = {
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  connected: boolean;
  send: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const createMockChildProcess = (): MockChildProcess => {
  const child: MockChildProcess = {
    on: vi.fn(),
    kill: vi.fn((signal?: string | number) => {
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        child.killed = true;
      }
      return true;
    }),
    killed: false,
    connected: true,
    send: vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    }),
    disconnect: vi.fn(() => {
      child.connected = false;
    }),
  };

  return child;
};

const { forkMock, forkedChildren } = vi.hoisted(() => {
  const forkedChildren: MockChildProcess[] = [];
  const forkMock = vi.fn(() => {
    const child: MockChildProcess = {
      on: vi.fn(),
      kill: vi.fn((signal?: string | number) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          child.killed = true;
        }
        return true;
      }),
      killed: false,
      connected: true,
      send: vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
        callback?.(null);
        return true;
      }),
      disconnect: vi.fn(() => {
        child.connected = false;
      }),
    };

    forkedChildren.push(child);
    return child;
  });

  return { forkMock, forkedChildren };
});

// Mock child_process
vi.mock("node:child_process", () => ({
  fork: forkMock,
}));

describe("ChildProcessRuntime", () => {
  let runtime: ChildProcessRuntime;
  let runtimeAny: any;
  let mockCentralCore: CentralCore;
  const testConfig: ProjectRuntimeConfig = {
    projectId: "proj_test123",
    workingDirectory: "/tmp/test-project",
    isolationMode: "child-process",
    maxConcurrent: 2,
    maxWorktrees: 4,
  };

  beforeEach(() => {
    mockCentralCore = {
      getGlobalConcurrencyState: vi.fn().mockResolvedValue({
        globalMaxConcurrent: 4,
        currentlyActive: 0,
        queuedCount: 0,
        projectsActive: {},
      }),
    } as unknown as CentralCore;

    runtime = new ChildProcessRuntime(testConfig, mockCentralCore);
    runtimeAny = runtime as any;

    vi.spyOn(IpcHost.prototype, "sendCommand").mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      await runtime.stop();
    } catch {
      // Ignore errors during cleanup
    }

    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    forkedChildren.length = 0;
  });

  describe("lifecycle", () => {
    it("should start with status 'stopped'", () => {
      expect(runtime.getStatus()).toBe("stopped");
    });

    it("should throw when getting TaskStore", () => {
      expect(() => runtime.getTaskStore()).toThrow("not accessible in ChildProcessRuntime");
    });

    it("should throw when getting Scheduler", () => {
      expect(() => runtime.getScheduler()).toThrow("not accessible in ChildProcessRuntime");
    });

    it("should return metrics even when stopped", () => {
      const metrics = runtime.getMetrics();
      expect(metrics.inFlightTasks).toBe(0);
      expect(metrics.activeAgents).toBe(0);
      expect(metrics.lastActivityAt).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should store projectId in config", () => {
      expect(testConfig.projectId).toBe("proj_test123");
    });

    it("should store workingDirectory in config", () => {
      expect(testConfig.workingDirectory).toBe("/tmp/test-project");
    });

    it("should have child-process isolation mode", () => {
      expect(testConfig.isolationMode).toBe("child-process");
    });
  });

  describe("event handling", () => {
    it("should support health-changed event", () => {
      const handler = vi.fn();
      runtime.on("health-changed", handler);

      // The constructor may emit health-changed, so we just verify
      // the event listener can be registered
      expect(handler).not.toHaveBeenCalled();
    });

    it("should support error event", () => {
      const handler = vi.fn();
      runtime.on("error", handler);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("timer lifecycle and generation safety", () => {
    it("cancels SIGKILL path after stop and never force-kills", async () => {
      vi.useFakeTimers();

      await runtime.start();
      const child = forkedChildren.at(-1);
      expect(child).toBeDefined();

      const errorHandler = vi.fn();
      runtime.on("error", errorHandler);

      await runtime.stop();
      vi.advanceTimersByTime(6000);

      expect(child?.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child?.kill).not.toHaveBeenCalledWith("SIGKILL");
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it("cancels prior SIGKILL timer when killChild is called again", () => {
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const firstChild = createMockChildProcess();
      runtimeAny.child = firstChild;

      runtimeAny.killChild();
      const firstTimer = runtimeAny.sigkillTimer;
      expect(firstTimer).not.toBeNull();

      const secondChild = createMockChildProcess();
      runtimeAny.child = secondChild;
      runtimeAny.killChild();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer);

      vi.advanceTimersByTime(6000);

      expect(firstChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(secondChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(secondChild.kill).not.toHaveBeenCalledWith("SIGKILL");
    });

    it("prevents stale SIGKILL timers from killing a newer generation child", () => {
      vi.useFakeTimers();

      const oldChild = createMockChildProcess();
      runtimeAny.child = oldChild;
      runtimeAny.generation = 10;

      runtimeAny.killChild();

      const replacementChild = createMockChildProcess();
      runtimeAny.generation = 11;
      runtimeAny.child = replacementChild;

      vi.advanceTimersByTime(6000);

      expect(oldChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(replacementChild.kill).not.toHaveBeenCalledWith("SIGKILL");
    });

    it("cancels restart timer on stop", async () => {
      vi.useFakeTimers();

      runtimeAny.status = "active";
      const spawnSpy = vi.spyOn(runtimeAny, "spawnChild").mockResolvedValue(undefined);

      runtimeAny.handleUnhealthy();
      await runtime.stop();

      vi.advanceTimersByTime(20000);

      expect(spawnSpy).not.toHaveBeenCalled();
      expect(forkMock).not.toHaveBeenCalled();
    });

    it("prevents stale restart callbacks when generation changes", () => {
      vi.useFakeTimers();

      runtimeAny.status = "active";
      const killSpy = vi.spyOn(runtimeAny, "killChild").mockImplementation(() => {});
      const spawnSpy = vi.spyOn(runtimeAny, "spawnChild").mockResolvedValue(undefined);

      runtimeAny.handleUnhealthy();
      runtimeAny.generation += 1;

      vi.advanceTimersByTime(1000);

      expect(killSpy).not.toHaveBeenCalled();
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(runtimeAny.restartTimer).toBeNull();
    });

    it("prevents restart callbacks while stopping/stopped", () => {
      vi.useFakeTimers();

      runtimeAny.status = "active";
      const killSpy = vi.spyOn(runtimeAny, "killChild").mockImplementation(() => {});
      const spawnSpy = vi.spyOn(runtimeAny, "spawnChild").mockResolvedValue(undefined);

      runtimeAny.handleUnhealthy();
      runtimeAny.status = "stopping";

      vi.advanceTimersByTime(1000);

      expect(killSpy).not.toHaveBeenCalled();
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(runtimeAny.restartTimer).toBeNull();
    });

    it("clearAllTimers cancels both SIGKILL and restart timers together via stop", async () => {
      vi.useFakeTimers();

      runtimeAny.status = "active";
      const child = createMockChildProcess();
      runtimeAny.child = child;

      const spawnSpy = vi.spyOn(runtimeAny, "spawnChild").mockResolvedValue(undefined);

      runtimeAny.killChild();
      runtimeAny.handleUnhealthy();

      expect(runtimeAny.sigkillTimer).not.toBeNull();
      expect(runtimeAny.restartTimer).not.toBeNull();

      await runtime.stop();
      vi.advanceTimersByTime(20000);

      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(runtimeAny.sigkillTimer).toBeNull();
      expect(runtimeAny.restartTimer).toBeNull();
    });

    it("increments generation on each spawnChild call", async () => {
      vi.useFakeTimers();

      expect(runtimeAny.generation).toBe(0);

      await runtimeAny.spawnChild();
      expect(runtimeAny.generation).toBe(1);

      runtimeAny.killChild();
      await runtimeAny.spawnChild();
      expect(runtimeAny.generation).toBe(2);

      expect(forkMock).toHaveBeenCalledTimes(2);
    });
  });
});
