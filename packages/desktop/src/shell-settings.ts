import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

export interface ShellConnectionProfile {
  id: string;
  name: string;
  serverUrl: string;
  authToken?: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
}

export interface DesktopShellSettings {
  desktopMode: "local" | "remote";
  activeProfileId: string | null;
  profiles: ShellConnectionProfile[];
}

const DEFAULT_SETTINGS: DesktopShellSettings = {
  desktopMode: "remote",
  activeProfileId: null,
  profiles: [],
};

function getSettingsPath(): string {
  return join(app.getPath("userData"), "shell-connections.json");
}

function normalize(input: unknown): DesktopShellSettings {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = input as Partial<DesktopShellSettings>;
  return {
    desktopMode: candidate.desktopMode === "local" ? "local" : "remote",
    activeProfileId: typeof candidate.activeProfileId === "string" ? candidate.activeProfileId : null,
    profiles: Array.isArray(candidate.profiles) ? candidate.profiles.filter((item) => item && typeof item === "object") as ShellConnectionProfile[] : [],
  };
}

export async function readShellSettings(): Promise<DesktopShellSettings> {
  try {
    const raw = await readFile(getSettingsPath(), "utf-8");
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeShellSettings(settings: DesktopShellSettings): Promise<void> {
  const path = getSettingsPath();
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2), "utf-8");
  await rename(temp, path);
}
