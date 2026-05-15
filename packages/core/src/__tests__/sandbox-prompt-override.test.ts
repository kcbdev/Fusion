import { describe, expect, it } from "vitest";
import { SANDBOX_BACKEND_NAMES } from "../settings-validation.js";
import { parseSandboxPromptOverride, resolveSandboxBackend } from "../sandbox-prompt-override.js";

describe("sandbox prompt override", () => {
  describe("parseSandboxPromptOverride", () => {
    it.each(SANDBOX_BACKEND_NAMES)("parses %s", (backend) => {
      expect(parseSandboxPromptOverride(`**Sandbox:** ${backend}`)).toBe(backend);
    });

    it("parses when prefix casing varies", () => {
      expect(parseSandboxPromptOverride("**sAnDbOx:** native")).toBe("native");
    });

    it("does not accept mixed-case backend values", () => {
      expect(parseSandboxPromptOverride("**Sandbox:** Docker")).toBeUndefined();
    });

    it("parses in multi-line prompt content", () => {
      expect(parseSandboxPromptOverride("# Task\nSome content\n**Sandbox:** podman\nMore text")).toBe("podman");
    });

    it("returns undefined for missing or malformed inputs", () => {
      expect(parseSandboxPromptOverride(undefined)).toBeUndefined();
      expect(parseSandboxPromptOverride("")).toBeUndefined();
      expect(parseSandboxPromptOverride("Sandbox: docker")).toBeUndefined();
      expect(parseSandboxPromptOverride("**Sandbox:** firejail")).toBeUndefined();
    });
  });

  describe("resolveSandboxBackend", () => {
    it("prefers prompt override", () => {
      expect(
        resolveSandboxBackend(
          { sandbox: { backend: "docker" } },
          "**Sandbox:** bubblewrap",
        ),
      ).toEqual({ backend: "bubblewrap", source: "prompt" });
    });

    it("falls back to project setting", () => {
      expect(resolveSandboxBackend({ sandbox: { backend: "podman" } }, undefined)).toEqual({
        backend: "podman",
        source: "project",
      });
    });

    it("falls back to default", () => {
      expect(resolveSandboxBackend(undefined, undefined)).toEqual({
        backend: "native",
        source: "default",
      });
    });
  });
});
