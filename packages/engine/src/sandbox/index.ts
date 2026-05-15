import { BubblewrapBackend } from "./bubblewrap-backend.js";
import { NativeSandboxBackend } from "./native.js";
import { SandboxExecBackend } from "./sandbox-exec-backend.js";
import type { SandboxBackend, SandboxCapabilities } from "./types.js";

export type {
  SandboxBackend,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxRunOptions,
  SandboxRunResult,
  SandboxRunStreamingOptions,
  SandboxStreamingResult,
} from "./types.js";

let sandboxBackendOverrideForTests: SandboxBackend | null = null;

export function __setSandboxBackendForTests(backend: SandboxBackend | null): void {
  sandboxBackendOverrideForTests = backend;
}

export function __resetSandboxBackendForTests(): void {
  sandboxBackendOverrideForTests = null;
}

export function resolveSandboxBackend(options?: { backendId?: SandboxCapabilities["id"] }): SandboxBackend {
  if (sandboxBackendOverrideForTests) {
    return sandboxBackendOverrideForTests;
  }

  if (options?.backendId === "bubblewrap" && process.platform === "linux") {
    return new BubblewrapBackend();
  }

  if (options?.backendId === "sandbox-exec") {
    if (process.platform === "darwin") {
      return new SandboxExecBackend();
    }
    return new NativeSandboxBackend();
  }

  return new NativeSandboxBackend();
}
