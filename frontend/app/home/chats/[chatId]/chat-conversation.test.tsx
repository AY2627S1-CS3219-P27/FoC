import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationState } from "@/lib/chat/conversation-reducer";
import { ChatConversation } from "./chat-conversation";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  loadOlder: vi.fn(),
  reconnect: vi.fn(),
  recoverArchive: vi.fn(),
  errand: vi.fn(),
}));

vi.mock("@/lib/chat/use-chat-conversation", () => ({ useChatConversation: mocks.useConversation }));
vi.mock("@/lib/chat/use-chat-errand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/use-chat-errand")>()),
  useChatErrand: () => mocks.errand(),
}));
vi.mock("@/lib/users/names", () => ({ useDisplayName: (id: string | null) => (id ? "Alex Tan" : null) }));
vi.mock("../../_shell/home-shell", () => ({
  useHomeContext: () => ({
    user: {
      uuid: "11111111-1111-4111-8111-111111111111",
      email: "requester@u.nus.edu",
      displayName: "Requester",
      profilePictureUrl: null,
      roles: [],
      isAdmin: false,
    },
    socketPath: "/socket.io",
  }),
}));

const chatId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

function message(sequence: number, senderUserId = otherId) {
  return {
    messageId: `${String(sequence).padStart(8, "0")}-4444-4444-8444-444444444444`,
    sequence,
    senderUserId,
    content: `message ${sequence}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    status: "UNREAD" as const,
  };
}

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    olderCursor: null,
    hasOlder: false,
    loadingOlder: false,
    pending: [],
    connection: "connected",
    join: { chatId, state: "ACTIVE", closesAt: null, closeReason: null, latestSequence: 0 },
    archived: null,
    archiveRecovery: "idle",
    participantRole: null,
    errandId: null,
    counterpartUserId: null,
    error: null,
    conflict: false,
    ...overrides,
  };
}

function provide(current: ConversationState) {
  mocks.useConversation.mockReturnValue({
    state: current,
    send: mocks.send,
    retry: mocks.retry,
    loadOlder: mocks.loadOlder,
    reconnect: mocks.reconnect,
    recoverArchive: mocks.recoverArchive,
  });
}

describe("ChatConversation", () => {
  beforeEach(() => {
    mocks.errand.mockReturnValue(null);
    provide(state());
  });

  it("opens errand details from the chat title and closes them with Done", async () => {
    const user = userEvent.setup();
    mocks.errand.mockReturnValue({
      pickupName: "The Deck",
      pickupLocation: "Level 2 canteen",
      deliveryLocation: "COM1",
      deliveryDetail: "Level 3 04-02",
      deliveryVenue: null,
      collectionItems: "2x chicken rice",
    });
    provide(state({ participantRole: "REQUESTER", errandId: "e1", counterpartUserId: otherId }));
    render(<ChatConversation chatId={chatId} />);

    await user.click(screen.getByRole("button", { name: /show errand details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Alex Tan");
    expect(dialog).toHaveTextContent("Courier");
    expect(dialog).toHaveTextContent("The Deck · Level 2 canteen");
    expect(dialog).toHaveTextContent("COM1 · Level 3 04-02");
    expect(dialog).toHaveTextContent("2x chicken rice");

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("disables the errand details trigger until the errand has loaded", () => {
    render(<ChatConversation chatId={chatId} />);
    expect(screen.getByRole("button", { name: /show errand details/i })).toBeDisabled();
  });

  it("keeps lifecycle status outside the fixed transcript and supports natural keyboard sending", async () => {
    const user = userEvent.setup();
    provide(state({
      participantRole: "REQUESTER",
      join: {
        chatId,
        state: "GRACE",
        closesAt: "2099-01-01T03:00:00.000Z",
        closeReason: "ERRAND_DELIVERED",
        latestSequence: 0,
      },
    }));
    const { container } = render(<ChatConversation chatId={chatId} />);

    const panel = container.querySelector("section");
    const transcript = container.querySelector("[aria-live='polite']");
    expect(panel).toHaveClass("h-dvh", "overflow-hidden");
    expect(transcript).toHaveClass("overflow-y-auto", "min-h-0");
    expect(screen.getByText(/The errand was delivered/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Errand chat · Requester" })).toBeVisible();
    expect(transcript).not.toContainElement(screen.getByText(/The errand was delivered/));

    const composer = screen.getByRole("textbox", { name: "Message" });
    await user.type(composer, "hello{enter}");
    expect(mocks.send).toHaveBeenCalledWith("hello");
    expect(composer).toHaveValue("");

    await user.type(composer, "line one{shift>}{enter}{/shift}line two");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(composer).toHaveValue("line one\nline two");
  });

  it("does not pull a reader away from older messages but follows new messages at the bottom", async () => {
    provide(state({ messages: [message(1)] }));
    const { container, rerender } = render(<ChatConversation chatId={chatId} />);
    const transcript = container.querySelector("[aria-live='polite']") as HTMLDivElement;
    const scrollTo = vi.fn();
    transcript.scrollTo = scrollTo;
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(transcript);
    scrollTo.mockClear();

    provide(state({ messages: [message(1), message(2)] }));
    rerender(<ChatConversation chatId={chatId} />);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(scrollTo).not.toHaveBeenCalled();

    transcript.scrollTop = 700;
    fireEvent.scroll(transcript);
    provide(state({ messages: [message(1), message(2), message(3)] }));
    rerender(<ChatConversation chatId={chatId} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  });
});
