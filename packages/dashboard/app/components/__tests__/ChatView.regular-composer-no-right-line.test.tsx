import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatView } from "../ChatView";
import * as useChatModule from "../../hooks/useChat";
import * as useChatRoomsModule from "../../hooks/useChatRooms";
import type { UseChatReturn } from "../../hooks/useChat";
import type { UseChatRoomsResult } from "../../hooks/useChatRooms";
import { _resetInitialViewportHeight } from "../../hooks/useMobileKeyboard";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("../../hooks/useChat");
vi.mock("../../hooks/useChatRooms");
vi.mock("../../hooks/useNavigationHistory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useNavigationHistory")>();
  return {
    ...actual,
    useNavigationHistoryContext: () => ({ pushNav: vi.fn(), replaceCurrent: vi.fn() }),
  };
});
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    fetchAgents: vi.fn().mockResolvedValue([]),
    fetchDiscoveredSkills: vi.fn().mockResolvedValue([]),
    fetchTasks: vi.fn().mockResolvedValue([]),
    searchFiles: vi.fn().mockResolvedValue({ files: [] }),
  };
});

const chatViewCss = readFileSync(resolve(__dirname, "../ChatView.css"), "utf8");
const mockUseChat = vi.mocked(useChatModule.useChat);
const mockUseChatRooms = vi.mocked(useChatRoomsModule.useChatRooms);

const defaultChatState: UseChatReturn = {
  sessions: [],
  activeSession: null,
  sessionsLoading: false,
  messages: [],
  messagesLoading: false,
  isStreaming: false,
  streamingText: "",
  streamingThinking: "",
  streamingToolCalls: [],
  selectSession: vi.fn(),
  createSession: vi.fn(),
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  pendingMessage: "",
  clearPendingMessage: vi.fn(),
  loadMoreMessages: vi.fn(),
  hasMoreMessages: false,
  searchQuery: "",
  setSearchQuery: vi.fn(),
  filteredSessions: [],
  refreshSessions: vi.fn(),
  agentsMap: new Map(),
};

const defaultRoomsState: UseChatRoomsResult = {
  rooms: [],
  roomsLoading: false,
  roomsError: null,
  activeRoom: null,
  activeRoomMembers: [],
  messages: [],
  messagesLoading: false,
  selectRoom: vi.fn(),
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  sendRoomMessage: vi.fn().mockResolvedValue(undefined),
  refreshRooms: vi.fn(),
};

describe("ChatView regular composer right-edge artifact regression", () => {
  beforeEach(() => {
    _resetInitialViewportHeight();
    vi.clearAllMocks();
    mockUseChat.mockReturnValue(defaultChatState);
    mockUseChatRooms.mockReturnValue(defaultRoomsState);
  });

  it("keeps textarea sizing rules and wrapper border invariants that prevent a right-edge line", () => {
    render(<ChatView projectId="proj-123" addToast={vi.fn()} />);

    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();

    const textareaRule = chatViewCss.match(/\.chat-input-textarea\s*\{[^}]*\}/);
    expect(textareaRule).not.toBeNull();
    expect(textareaRule?.[0]).toContain("box-sizing: border-box");
    expect(textareaRule?.[0]).toContain("width: 100%");
    expect(textareaRule?.[0]).toContain("-webkit-appearance: none");
    expect(textareaRule?.[0]).toContain("appearance: none");

    const wrapperRule = chatViewCss.match(/\.chat-input-wrapper\s*\{[^}]*\}/);
    expect(wrapperRule).not.toBeNull();
    expect(wrapperRule?.[0]).not.toMatch(/border(?:-right)?\s*:/);

    const dragoverRule = chatViewCss.match(/\.chat-input-wrapper--dragover\s*\{[^}]*\}/);
    expect(dragoverRule).not.toBeNull();
    expect(dragoverRule?.[0]).toContain("border: 1px dashed var(--todo)");
  });
});
