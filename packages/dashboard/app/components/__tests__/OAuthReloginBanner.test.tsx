import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthReloginBanner } from "../OAuthReloginBanner";
import * as api from "../../api";
import { OAUTH_RELOGIN_SUCCESS_EVENT } from "../../auth";

vi.mock("../../api", () => ({
  fetchAuthStatus: vi.fn(),
}));

const mockFetchAuthStatus = vi.mocked(api.fetchAuthStatus);

describe("OAuthReloginBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders nothing when no providers are expired", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "github-copilot", name: "GitHub Copilot", authenticated: true, type: "oauth", expired: false }],
    });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    await waitFor(() => {
      expect(mockFetchAuthStatus).toHaveBeenCalledTimes(1);
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders a banner for one expired oauth provider", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
    });

    render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    expect(await screen.findByText(/Re-login required: Claude/i)).toBeInTheDocument();
    expect(screen.getByText(/Your Claude session expired/i)).toBeInTheDocument();
  });

  it("renders a comma-joined list when multiple providers are expired", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [
        { id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true },
        { id: "github-copilot", name: "GitHub Copilot", authenticated: false, type: "oauth", expired: true },
      ],
    });

    render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    expect(await screen.findByText("Re-login required: Claude, GitHub Copilot")).toBeInTheDocument();
  });

  it("calls onReLogin with providerId for single and undefined for multi", async () => {
    const onReLogin = vi.fn();
    mockFetchAuthStatus
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [
          { id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true },
          { id: "github-copilot", name: "GitHub Copilot", authenticated: false, type: "oauth", expired: true },
        ],
      });

    render(<OAuthReloginBanner onReLogin={onReLogin} pollIntervalMs={1_000} />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-login" }));
    expect(onReLogin).toHaveBeenCalledWith("claude");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Re-login" }));
    expect(onReLogin).toHaveBeenLastCalledWith(undefined);
  });

  it("dismisses banner and stores provider ids in localStorage", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
    });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /dismiss oauth re-login banner/i }));

    expect(container.firstChild).toBeNull();
    expect(window.localStorage.getItem("fusion:oauth-relogin-dismissed")).toBe(JSON.stringify(["claude"]));
  });

  it("keeps banner dismissed until provider recovers then expires again", async () => {
    mockFetchAuthStatus
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: true, type: "oauth", expired: false }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} pollIntervalMs={1_000} />);

    fireEvent.click(await screen.findByRole("button", { name: /dismiss oauth re-login banner/i }));
    expect(container.firstChild).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.firstChild).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.firstChild).toBeNull();
    expect(window.localStorage.getItem("fusion:oauth-relogin-dismissed")).toBe(JSON.stringify([]));

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(await screen.findByText(/Re-login required: Claude/i)).toBeInTheDocument();
  });

  it("ignores expired flags on api_key and cli providers", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [
        { id: "openrouter", name: "OpenRouter", authenticated: false, type: "api_key", expired: true },
        { id: "claude-cli", name: "Anthropic — via Claude CLI", authenticated: false, type: "cli", expired: true },
      ],
    });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    await waitFor(() => {
      expect(mockFetchAuthStatus).toHaveBeenCalledTimes(1);
    });
    expect(container.firstChild).toBeNull();
  });

  it("clears a provider row immediately when oauth relogin success event is dispatched", async () => {
    mockFetchAuthStatus
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: true, type: "oauth", expired: false }],
      });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} pollIntervalMs={1_000} />);

    expect(await screen.findByText(/Re-login required: Claude/i)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(OAUTH_RELOGIN_SUCCESS_EVENT, { detail: { providerId: "claude" } }));
    });

    expect(container.firstChild).toBeNull();
  });

  it("triggers an immediate auth status refetch when oauth relogin success event is dispatched", async () => {
    mockFetchAuthStatus
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: true, type: "oauth", expired: false }],
      });

    render(<OAuthReloginBanner onReLogin={vi.fn()} pollIntervalMs={10_000} />);

    await screen.findByText(/Re-login required: Claude/i);
    expect(mockFetchAuthStatus).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent(OAUTH_RELOGIN_SUCCESS_EVENT, { detail: { providerId: "claude" } }));
    });

    await waitFor(() => {
      expect(mockFetchAuthStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("does not clear unrelated providers when event is for a different provider", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [
        { id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true },
        { id: "github-copilot", name: "GitHub Copilot", authenticated: false, type: "oauth", expired: true },
      ],
    });

    render(<OAuthReloginBanner onReLogin={vi.fn()} />);

    expect(await screen.findByText("Re-login required: Claude, GitHub Copilot")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(OAUTH_RELOGIN_SUCCESS_EVENT, { detail: { providerId: "openai" } }));
    });

    expect(screen.getByText("Re-login required: Claude, GitHub Copilot")).toBeInTheDocument();
  });

  it("keeps provider row until poll result changes when no success event is dispatched", async () => {
    mockFetchAuthStatus
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: false, type: "oauth", expired: true }],
      })
      .mockResolvedValueOnce({
        providers: [{ id: "claude", name: "Claude", authenticated: true, type: "oauth", expired: false }],
      });

    const { container } = render(<OAuthReloginBanner onReLogin={vi.fn()} pollIntervalMs={1_000} />);

    expect(await screen.findByText(/Re-login required: Claude/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(await screen.findByText(/Re-login required: Claude/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.firstChild).toBeNull();
  });
});
