import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NativeShellOnboardingModal } from "../NativeShellOnboardingModal";

describe("NativeShellOnboardingModal", () => {
  it("shows desktop mode options", () => {
    render(
      <NativeShellOnboardingModal
        open={true}
        shellApi={{
          getState: vi.fn(),
          listProfiles: vi.fn(),
          saveProfile: vi.fn(),
          deleteProfile: vi.fn(),
          setActiveProfile: vi.fn(),
          setDesktopMode: vi.fn(),
          startQrScan: vi.fn(),
          openConnectionManager: vi.fn(),
          subscribe: vi.fn(() => () => undefined),
        }}
        shellState={{ host: "desktop-shell", desktopMode: "remote", activeProfileId: null, profiles: [] }}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Local Fusion")).toBeInTheDocument();
    expect(screen.getByText("Remote Server")).toBeInTheDocument();
  });

  it("saves remote profile and redirects to remote dashboard", async () => {
    const saveProfile = vi.fn(async () => ({ id: "p1", serverUrl: "https://fusion.example.com", authToken: null }));
    const setActiveProfile = vi.fn(async () => ({ host: "mobile-shell", activeProfileId: "p1", profiles: [] }));
    const onComplete = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, href: "http://localhost" },
    });

    render(
      <NativeShellOnboardingModal
        open={true}
        shellApi={{
          getState: vi.fn(),
          listProfiles: vi.fn(),
          saveProfile,
          deleteProfile: vi.fn(),
          setActiveProfile,
          setDesktopMode: vi.fn(),
          startQrScan: vi.fn(),
          openConnectionManager: vi.fn(),
          subscribe: vi.fn(() => () => undefined),
        }}
        shellState={{ host: "mobile-shell", activeProfileId: null, profiles: [] }}
        onComplete={onComplete}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("https://your-fusion-host"), { target: { value: "https://fusion.example.com" } });
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalled();
      expect(setActiveProfile).toHaveBeenCalledWith("p1");
      expect(window.location.href).toContain("https://fusion.example.com");
    });

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
