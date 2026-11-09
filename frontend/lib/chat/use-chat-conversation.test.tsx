import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatConversation } from "./use-chat-conversation";

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  getMessageHistory: vi.fn(),
  findArchiveByChatId: vi.fn(),
  findLiveChatById: vi.fn(),
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("./api", () => ({
  getMessageHistory: mocks.getMessageHistory,
  findArchiveByChatId: mocks.findArchiveByChatId,
  findLiveChatById: mocks.findLiveChatById,
}));

type Handler = (payload?: unknown) => void;

class FakeSocket {
  connected = false;
  handlers = new Map<string, Set<Handler>>();
  sent: Array<{ event: string; payload: unknown }> = [];
  sendResponses: unknown[] = [];

  on(event: string, handler: Handler) {
    const handlers = this.handlers.get(event) ?? new Set<Handler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, payload: unknown, acknowledgement: (response: unknown) => void) {
    this.sent.push({ event, payload });
    if (event === "chat:join") {
      acknowledgement({
        ok: true,
        data: { chatId, state: "ACTIVE", closesAt: null, closeReason: null, latestSequence: 1 },
      });
    } else if (event === "message:send") {
      acknowledgement(this.sendResponses.shift());
    } else if (event === "messages:read") {
      acknowledgement({
        ok: true,
        data: { chatId, throughSequence: 1, highestReadSequence: 1, readAt: "2026-01-01T00:00:01.000Z" },
      });
    }
    return this;
  }

  connect() {
    this.connected = true;
    this.trigger("connect");
    return this;
  }

  disconnect() {
    this.connected = false;
    this.trigger("disconnect", "io client disconnect");
    return this;
  }

  removeAllListeners() {
    this.handlers.clear();
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const callerId = "11111111-1111-4111-8111-111111111111";
const chatId = "22222222-2222-4222-8222-222222222222";
const clientMessageId = "33333333-3333-4333-8333-333333333333";
const initialMessage = {
  messageId: "44444444-4444-4444-8444-444444444444",
  sequence: 1,
  senderUserId: callerId,
  content: "existing",
  timestamp: "2026-01-01T00:00:00.000Z",
  status: "UNREAD",
} as const;

describe("useChatConversation", () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    mocks.io.mockReturnValue(socket);
    mocks.getMessageHistory.mockResolvedValue({ items: [initialMessage], hasMore: false, nextCursor: null });
    mocks.findArchiveByChatId.mockResolvedValue(null);
    mocks.findLiveChatById.mockResolvedValue(null);
  });

  it("joins through the deterministic socket double and applies closing/archive events", async () => {
    const { result, unmount } = renderHook(() => useChatConversation(chatId, callerId, "/socket.io"));
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));
    expect(socket.sent.find((item) => item.event === "chat:join")?.payload).toEqual({ chatId });

    act(() => socket.trigger("chat:closing", {
      chatId,
      closesAt: "2026-01-01T03:00:00.000Z",
      closeReason: "ERRAND_DELIVERED",
    }));
    expect(result.current.state.join?.state).toBe("GRACE");

    act(() => socket.trigger("chat:archived", {
      chatId,
      archiveId: "55555555-5555-4555-8555-555555555555",
      archivedAt: "2026-01-01T03:00:01.000Z",
    }));
    expect(result.current.state.archived?.archiveId).toBe("55555555-5555-4555-8555-555555555555");
    expect(socket.connected).toBe(false);
    unmount();
  });

  it("shows offline instead of reconnecting when the server drops the connection", async () => {
    const { result } = renderHook(() => useChatConversation(chatId, callerId, "/socket.io"));
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));

    act(() => socket.trigger("disconnect", "transport close"));
    expect(result.current.state.connection).toBe("reconnecting");

    act(() => socket.trigger("disconnect", "io server disconnect"));
    expect(result.current.state.connection).toBe("offline");
  });

  it("does not re-page already loaded history when resynchronizing", async () => {
    const message = (sequence: number) => ({
      ...initialMessage,
      messageId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      sequence,
    });
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
    mocks.getMessageHistory.mockImplementation(async (_chatId: string, options: { cursor?: string }) => {
      if (options.cursor === "c70") return { items: range(21, 70), hasMore: true, nextCursor: "c20" };
      if (options.cursor === "c20") return { items: range(1, 20), hasMore: false, nextCursor: null };
      return { items: range(71, 120), hasMore: true, nextCursor: "c70" };
    });

    const { result } = renderHook(() => useChatConversation(chatId, callerId, "/socket.io"));
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));
    await act(() => result.current.loadOlder());
    await act(() => result.current.loadOlder());
    expect(result.current.state.messages[0]?.sequence).toBe(1);

    mocks.getMessageHistory.mockClear();
    act(() => socket.trigger("connect"));
    await waitFor(() => expect(mocks.getMessageHistory).toHaveBeenCalled());
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));

    const cursorFetches = mocks.getMessageHistory.mock.calls.filter(([, options]) => options.cursor);
    expect(cursorFetches).toHaveLength(0);
    expect(result.current.state.messages).toHaveLength(120);
  });

  it("reuses the same clientMessageId when a failed send is retried", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(clientMessageId);
    socket.sendResponses.push(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Unable to complete request" } },
      {
        ok: true,
        data: {
          messageId: "66666666-6666-4666-8666-666666666666",
          sequence: 2,
          senderUserId: callerId,
          content: "retry me",
          timestamp: "2026-01-01T00:00:02.000Z",
          status: "UNREAD",
        },
      },
    );
    const { result } = renderHook(() => useChatConversation(chatId, callerId, "/socket.io"));
    await waitFor(() => expect(result.current.state.connection).toBe("connected"));

    act(() => result.current.send("retry me"));
    await waitFor(() => expect(result.current.state.pending[0]?.state).toBe("failed"));
    act(() => result.current.retry(clientMessageId));
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0));

    const sends = socket.sent.filter((item) => item.event === "message:send");
    expect(sends).toHaveLength(2);
    expect(sends.map((item) => (item.payload as { clientMessageId: string }).clientMessageId)).toEqual([
      clientMessageId,
      clientMessageId,
    ]);
  });
});
