/*
FNXC:DesktopOAuth 2026-07-18-04:00:
OAuth login handlers call window.open AFTER awaiting POST /auth/login. When
the round trip outlives Chromium's transient user activation (~5s — observed
with the OpenAI Codex flow while the Anthropic flow, being faster, worked),
the popup is silently blocked in the desktop app and the system browser never
opens. On desktop, prefer the activation-free shell:openExternal IPC bridge;
in the web app fall back to window.open.
*/

interface DesktopShellApi {
  openExternal?: (url: string) => Promise<boolean>;
}

function desktopShellApi(): DesktopShellApi | undefined {
  const w = window as unknown as { fusionAPI?: DesktopShellApi; electronAPI?: DesktopShellApi };
  return w.fusionAPI ?? w.electronAPI;
}

/** Open a URL in the user's browser: desktop IPC when available, window.open otherwise. */
export function openExternalUrl(url: string): void {
  const api = desktopShellApi();
  if (typeof api?.openExternal === "function") {
    void api.openExternal(url).then((opened) => {
      if (!opened) window.open(url, "_blank");
    }).catch(() => {
      window.open(url, "_blank");
    });
    return;
  }
  window.open(url, "_blank");
}
