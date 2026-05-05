import { app, BrowserWindow, nativeImage, Tray } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDeepLinkHandler, registerDeepLinkProtocol } from "./deep-link.js";
import { registerIpcHandlers } from "./ipc.js";
import { buildAppMenu } from "./menu.js";
import {
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  saveWindowState,
  setupAutoUpdater,
  type WindowState,
} from "./native.js";
import { setupTray } from "./tray.js";
import { getRendererUrl, getRendererFilePath, isUrlRenderer } from "./renderer.js";
import { DesktopLocalServerManager } from "./local-server.js";
import { readShellSettings } from "./shell-settings.js";

// Re-export for backward compatibility
export { IS_DEVELOPMENT } from "./renderer.js";
export { DASHBOARD_URL } from "./renderer.js";

interface AppWithQuitFlag {
  isQuitting?: boolean;
}

function enableSourceMaps(): void {
  const processWithSourceMaps = process as NodeJS.Process & {
    setSourceMapsEnabled?: (enabled: boolean) => void;
  };
  processWithSourceMaps.setSourceMapsEnabled?.(true);
}

enableSourceMaps();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localServerManager: DesktopLocalServerManager | null = null;

function getAppWithQuitFlag(): Electron.App & AppWithQuitFlag {
  return app as Electron.App & AppWithQuitFlag;
}

export function createMainWindow(state?: WindowState): BrowserWindow {
  const hasValidPosition = typeof state?.x === "number" && typeof state?.y === "number";

  const window = new BrowserWindow({
    width: state?.width ?? DEFAULT_WINDOW_STATE.width,
    height: state?.height ?? DEFAULT_WINDOW_STATE.height,
    ...(hasValidPosition ? { x: state.x, y: state.y } : {}),
    title: "Fusion",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Use renderer module to determine how to load the UI
  if (isUrlRenderer()) {
    void window.loadURL(getRendererUrl());
  } else {
    void window.loadFile(getRendererFilePath());
  }

  window.on("close", (event) => {
    saveWindowState(window);

    if (getAppWithQuitFlag().isQuitting) {
      return;
    }

    event.preventDefault();
    window.hide();
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = window;
  return window;
}

export async function initializeApp(): Promise<void> {
  const state = await loadWindowState();
  const createdWindow = createMainWindow(state ?? undefined);

  buildAppMenu({
    mainWindow: createdWindow,
    appName: "Fusion",
  });

  localServerManager = new DesktopLocalServerManager(process.cwd());

  tray = new Tray(nativeImage.createEmpty());
  setupTray(createdWindow, tray);

  registerIpcHandlers(createdWindow, tray, {
    onDesktopModeChange: async (mode) => {
      if (!localServerManager) {
        return;
      }
      if (mode === "local") {
        await localServerManager.start();
      } else {
        await localServerManager.stop();
      }
    },
    getLocalServerState: () => localServerManager?.getState() ?? { status: "idle", error: null },
    getServerPort: () => localServerManager?.getPort(),
  });
  registerDeepLinkProtocol();
  setupDeepLinkHandler(createdWindow);
  setupAutoUpdater(createdWindow);

  const shellSettings = await readShellSettings();
  if (shellSettings.desktopMode === "local") {
    await localServerManager.start();
  }

  if (state?.isMaximized === true) {
    createdWindow.maximize();
  }
}

export function run(): void {
  const appWithQuitFlag = getAppWithQuitFlag();
  appWithQuitFlag.isQuitting = false;

  void app.whenReady().then(() => initializeApp());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    appWithQuitFlag.isQuitting = true;
    if (tray) {
      tray.destroy();
      tray = null;
    }

    if (localServerManager) {
      void localServerManager.stop();
    }
  });

  app.on("activate", () => {
    if (mainWindow === null) {
      const window = createMainWindow();
      window.show();
    }
  });
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  run();
}
