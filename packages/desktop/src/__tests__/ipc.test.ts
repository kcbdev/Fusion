import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
  };

  const app = {
    getVersion: vi.fn(() => "1.2.3"),
  };

  const updateTrayStatus = vi.fn();
  const showExportSettingsDialog = vi.fn();
  const showImportSettingsDialog = vi.fn();
  const setupAutoUpdater = vi.fn();
  const readShellSettings = vi.fn(async () => ({ desktopMode: "remote", activeProfileId: null, profiles: [] }));
  const writeShellSettings = vi.fn(async () => undefined);

  return {
    ipcMain,
    ipcHandlers,
    app,
    updateTrayStatus,
    showExportSettingsDialog,
    showImportSettingsDialog,
    setupAutoUpdater,
    readShellSettings,
    writeShellSettings,
  };
});

vi.mock("electron", () => ({
  ipcMain: mocks.ipcMain,
  app: mocks.app,
}));

vi.mock("../tray.js", () => ({
  updateTrayStatus: mocks.updateTrayStatus,
}));

vi.mock("../native.js", () => ({
  showExportSettingsDialog: mocks.showExportSettingsDialog,
  showImportSettingsDialog: mocks.showImportSettingsDialog,
  setupAutoUpdater: mocks.setupAutoUpdater,
}));

vi.mock("../shell-settings.js", () => ({
  readShellSettings: mocks.readShellSettings,
  writeShellSettings: mocks.writeShellSettings,
}));

function createWindowMock() {
  return {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
}

function createTrayMock() {
  return {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
  };
}

async function registerHandlers(options: Record<string, unknown> = {}) {
  const { registerIpcHandlers } = await import("../ipc.ts");
  const window = createWindowMock();
  const tray = createTrayMock();
  registerIpcHandlers(window as never, tray as never, options as never);
  return { window, tray };
}

describe("ipc handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.ipcHandlers.clear();
  });

  it("registers shell channels", async () => {
    await registerHandlers();

    const channels = new Set(mocks.ipcMain.handle.mock.calls.map(([channel]) => channel));
    expect(channels.has("shell:getState")).toBe(true);
    expect(channels.has("shell:saveProfile")).toBe(true);
    expect(channels.has("shell:setDesktopMode")).toBe(true);
    expect(channels.has("platform:get")).toBe(true);
  });

  it("shell:getState returns desktop shell state", async () => {
    await registerHandlers();
    const handler = mocks.ipcHandlers.get("shell:getState");
    const result = await handler?.({});

    expect(result).toMatchObject({ host: "desktop-shell", desktopMode: "remote" });
  });

  it("shell:setDesktopMode persists mode and emits state", async () => {
    const onDesktopModeChange = vi.fn(async () => undefined);
    const { window } = await registerHandlers({ onDesktopModeChange });
    const handler = mocks.ipcHandlers.get("shell:setDesktopMode");
    await handler?.({}, "local");

    expect(mocks.writeShellSettings).toHaveBeenCalled();
    expect(onDesktopModeChange).toHaveBeenCalledWith("local");
    expect(window.webContents.send).toHaveBeenCalledWith("shell:state", expect.any(Object));
  });
});
