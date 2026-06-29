import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { AuthenticationSection, type AuthenticationSectionData } from "../settings/sections/AuthenticationSection";
import type { AuthProvider } from "../../api";

vi.mock("../ProviderIcon", () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`mock-icon-${provider}`}>{provider}</span>,
}));

vi.mock("../PluginSlot", () => ({
  PluginSlot: ({ slotId }: { slotId: string }) => <div data-testid={`plugin-slot-${slotId}`} />,
}));

vi.mock("../LoginInstructions", () => ({
  LoginInstructions: ({ instructions }: { instructions: string }) => <div>{instructions}</div>,
}));

vi.mock("../LoadingSpinner", () => ({
  LoadingSpinner: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("../OAuthManualCodeForm", () => ({
  OAuthManualCodeForm: ({ prompt }: { prompt: string }) => <div>{prompt}</div>,
}));

vi.mock("../CustomProvidersSection", () => ({
  CustomProvidersSection: () => <div data-testid="custom-providers-section" />,
}));

vi.mock("../ClaudeCliProviderCard", () => ({ ClaudeCliProviderCard: () => <div /> }));
vi.mock("../CursorCliProviderCard", () => ({ CursorCliProviderCard: () => <div /> }));
vi.mock("../LlamaCppProviderCard", () => ({ LlamaCppProviderCard: () => <div /> }));

function renderAuthSection(providers: AuthProvider[], overrides: Partial<AuthenticationSectionData> = {}) {
  const handleLogin = vi.fn();
  const handleLogout = vi.fn();
  const handleSaveApiKey = vi.fn();
  const handleClearApiKey = vi.fn();

  function Harness() {
    const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
    const [manualCodeInputs, setManualCodeInputs] = useState<Record<string, string>>({});
    const auth: AuthenticationSectionData = {
      addToast: vi.fn(),
      authProviders: providers,
      authLoading: false,
      authActionInProgress: null,
      apiKeyInputs,
      setApiKeyInputs,
      apiKeyErrors: {},
      opencodeApiKeyRefreshStatus: {},
      deviceCodes: {},
      loginInstructions: {},
      manualCodeConfigs: {},
      manualCodeInputs,
      setManualCodeInputs,
      manualCodeSubmitInProgress: null,
      loadAuthStatus: vi.fn(),
      handleLogin,
      handleLogout,
      handleCancelLogin: vi.fn(),
      handleSaveApiKey,
      handleClearApiKey,
      handleSubmitManualCode: vi.fn(),
      ...overrides,
    };
    return <AuthenticationSection auth={auth} />;
  }

  render(<Harness />);
  return { handleLogin, handleLogout, handleSaveApiKey, handleClearApiKey };
}

describe("AuthenticationSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an unauthenticated dual Anthropic card with OAuth login and API-key save", () => {
    const { handleLogin, handleSaveApiKey } = renderAuthSection([
      { id: "anthropic", name: "Anthropic", authenticated: false, type: "oauth", supportsApiKey: true },
    ]);

    const card = screen.getByTestId("auth-provider-icon-anthropic").closest(".auth-provider-card") as HTMLElement;
    expect(within(card).getByRole("button", { name: "Login" })).toBeInTheDocument();
    fireEvent.change(within(card).getByPlaceholderText("Enter API key"), { target: { value: "sk-ant-api03-new" } });
    const saveButton = within(card).getByRole("button", { name: "Save" });
    expect(saveButton).toHaveClass("btn-primary");
    fireEvent.click(saveButton);
    fireEvent.click(within(card).getByRole("button", { name: "Login" }));

    expect(handleSaveApiKey).toHaveBeenCalledWith("anthropic");
    expect(handleLogin).toHaveBeenCalledWith("anthropic");
  });

  it("renders OAuth-only dual Anthropic as authenticated while keeping the API-key input", () => {
    const { handleLogout } = renderAuthSection([
      { id: "anthropic", name: "Anthropic", authenticated: true, type: "oauth", supportsApiKey: true },
    ]);

    const card = screen.getByTestId("auth-provider-icon-anthropic").closest(".auth-provider-card") as HTMLElement;
    expect(card).toHaveClass("auth-provider-card--authenticated");
    expect(within(card).getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(card).getByPlaceholderText("Enter API key")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Logout" }));

    expect(handleLogout).toHaveBeenCalledWith("anthropic");
  });

  it("renders API-key-only dual Anthropic with masked key hint and Clear", () => {
    const { handleClearApiKey } = renderAuthSection([
      { id: "anthropic", name: "Anthropic", authenticated: false, type: "oauth", supportsApiKey: true, keyHint: "sk-•••••1234" },
    ]);

    const card = screen.getByTestId("auth-provider-icon-anthropic").closest(".auth-provider-card") as HTMLElement;
    expect(card).not.toHaveClass("auth-provider-card--authenticated");
    expect(within(card).getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
    expect(within(card).getByText("Key: sk-•••••1234")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Clear" })).toBeInTheDocument();
    fireEvent.change(within(card).getByPlaceholderText("Enter API key"), { target: { value: "sk-ant-api03-replacement" } });
    expect(within(card).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.change(within(card).getByPlaceholderText("Enter API key"), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Clear" }));

    expect(handleClearApiKey).toHaveBeenCalledWith("anthropic");
  });

  it("renders both OAuth logout and API-key Clear when Anthropic has both credentials", () => {
    renderAuthSection([
      { id: "anthropic", name: "Anthropic", authenticated: true, type: "oauth", supportsApiKey: true, keyHint: "sk-•••••dkey" },
    ]);

    const card = screen.getByTestId("auth-provider-icon-anthropic").closest(".auth-provider-card") as HTMLElement;
    expect(within(card).getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});
