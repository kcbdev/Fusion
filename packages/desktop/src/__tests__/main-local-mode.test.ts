import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const app = {
    whenReady: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      appHandlers.set(event, handler);
      return app;
    }),
    quit: vi.fn(),
  };

  const browserWindow = {
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isMaximized: vi.fn(() => false),
    hide: vi.fn(),
    maximize: vi.fn(),
    webContents: { send: vi.fn() },
  };

  const BrowserWindow = vi.fn(() => browserWindow);
  const Tray = vi.fn(() => ({ destroy: vi.fn() }));

  const localServerManager = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    getState: vi.fn(() => ({ status: "idle", error: null })),
    getPort: vi.fn(() => undefined),
  };

  return { app, appHandlers, BrowserWindow, Tray, browserWindow, localServerManager };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  Tray: mocks.Tray,
  nativeImage: { createEmpty: vi.fn(() => ({})) },
}));

vi.mock("../renderer.js", () => ({ isUrlRenderer: vi.fn(() => true), getRendererUrl: vi.fn(() => "http://localhost"), getRendererFilePath: vi.fn(() => "index.html") }));
vi.mock("../menu.js", () => ({ buildAppMenu: vi.fn() }));
vi.mock("../tray.js", () => ({ setupTray: vi.fn() }));
vi.mock("../ipc.js", () => ({ registerIpcHandlers: vi.fn() }));
vi.mock("../native.js", () => ({ DEFAULT_WINDOW_STATE: { width: 1000, height: 800 }, loadWindowState: vi.fn(async () => null), saveWindowState: vi.fn(), setupAutoUpdater: vi.fn() }));
vi.mock("../deep-link.js", () => ({ registerDeepLinkProtocol: vi.fn(), setupDeepLinkHandler: vi.fn() }));
vi.mock("../shell-settings.js", () => ({ readShellSettings: vi.fn(async () => ({ desktopMode: "local", activeProfileId: null, profiles: [] })) }));
vi.mock("../local-server.js", () => ({ DesktopLocalServerManager: vi.fn(() => mocks.localServerManager) }));

describe("main local mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.appHandlers.clear();
  });

  it("starts local server manager when restored desktop mode is local", async () => {
    const { initializeApp } = await import("../main.ts");
    await initializeApp();

    expect(mocks.localServerManager.start).toHaveBeenCalled();
  });
});
