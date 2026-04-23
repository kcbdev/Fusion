import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin, { openclawRuntimeMetadata, openclawRuntimeFactory, OPENCLAW_RUNTIME_ID } from "../index.js";
function createMockContext(overrides = {}) {
    return {
        pluginId: "fusion-plugin-openclaw-runtime",
        settings: {},
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        emitEvent: vi.fn(),
        taskStore: {
            getTask: vi.fn(),
        },
        ...overrides,
    };
}
describe("openclaw-runtime plugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    describe("plugin manifest identity", () => {
        it("should have correct manifest fields", () => {
            expect(plugin.manifest.id).toBe("fusion-plugin-openclaw-runtime");
            expect(plugin.manifest.name).toBe("OpenClaw Runtime Plugin");
            expect(plugin.manifest.version).toBe("0.1.0");
            expect(plugin.manifest.description).toContain("OpenClaw");
            expect(plugin.manifest.author).toBe("Fusion Team");
            expect(plugin.state).toBe("installed");
        });
    });
    describe("runtime registration", () => {
        it("should register openclaw runtime metadata", () => {
            expect(plugin.runtime).toBeDefined();
            expect(plugin.runtime?.metadata.runtimeId).toBe(OPENCLAW_RUNTIME_ID);
            expect(plugin.runtime?.metadata.name).toBe("OpenClaw Runtime");
            expect(plugin.runtime?.metadata.description).toContain("execution deferred");
            expect(plugin.runtime?.metadata.version).toBe("0.1.0");
        });
        it("should have consistent runtime metadata between export and manifest", () => {
            expect(plugin.manifest.runtime).toEqual(openclawRuntimeMetadata);
            expect(plugin.runtime?.metadata).toEqual(openclawRuntimeMetadata);
        });
    });
    describe("hooks", () => {
        it("onLoad should log startup message and emit loaded event", async () => {
            const ctx = createMockContext();
            await plugin.hooks.onLoad?.(ctx);
            expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining("OpenClaw Runtime Plugin loaded"));
            expect(ctx.emitEvent).toHaveBeenCalledWith("openclaw-runtime:loaded", {
                runtimeId: OPENCLAW_RUNTIME_ID,
                version: "0.1.0",
                status: "deferred",
            });
        });
        it("onUnload should not throw", () => {
            expect(() => plugin.hooks.onUnload?.()).not.toThrow();
        });
    });
    describe("deferred runtime behavior", () => {
        it("should export runtime constants", () => {
            expect(OPENCLAW_RUNTIME_ID).toBe("openclaw");
            expect(openclawRuntimeMetadata.runtimeId).toBe("openclaw");
            expect(typeof openclawRuntimeFactory).toBe("function");
        });
        it("runtime factory should return placeholder runtime shape", () => {
            const runtime = openclawRuntimeFactory(createMockContext());
            expect(runtime).toMatchObject({
                runtimeId: "openclaw",
                version: "0.1.0",
                status: "deferred",
            });
            expect(runtime).toHaveProperty("message");
            expect(String(runtime.message)).toContain("discovery and configuration only");
            expect(String(runtime.message)).not.toContain("FN-");
        });
        it("runtime execute should reject with deferred/not-implemented error", async () => {
            const runtime = openclawRuntimeFactory(createMockContext());
            await expect(runtime.execute()).rejects.toThrow("not implemented");
            await expect(runtime.execute()).rejects.toThrow("deferred");
        });
        it("factory creation should not throw", () => {
            expect(() => openclawRuntimeFactory(createMockContext())).not.toThrow();
        });
    });
});
//# sourceMappingURL=index.test.js.map