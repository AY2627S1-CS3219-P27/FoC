import { describe, expect, it } from "vitest";
import { ChatContractError, parseArchiveDetail, parseChatView, parseMessageHistoryResponse } from "./contracts";

const message = {
  messageId: "11111111-1111-4111-8111-111111111111",
  sequence: 1,
  senderUserId: "22222222-2222-4222-8222-222222222222",
  content: "hello",
  timestamp: "2026-01-01T00:00:00.000Z",
  status: "UNREAD",
};

describe("chat runtime contracts", () => {
  it("rejects inconsistent grace state and unknown fields", () => {
    expect(() => parseChatView({
      chatId: "33333333-3333-4333-8333-333333333333",
      errandId: "44444444-4444-4444-8444-444444444444",
      requesterUserId: "22222222-2222-4222-8222-222222222222",
      courierUserId: "55555555-5555-4555-8555-555555555555",
      state: "GRACE",
      closesAt: null,
      closeReason: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastMessage: null,
      unread: false,
    })).toThrow(ChatContractError);
    expect(() => parseMessageHistoryResponse({ items: [message], hasMore: false, nextCursor: null, token: "leak" })).toThrow(ChatContractError);
  });

  it("rejects non-ascending history and malformed archive snapshots", () => {
    expect(() => parseMessageHistoryResponse({
      items: [{ ...message, sequence: 2 }, message],
      hasMore: false,
      nextCursor: null,
    })).toThrow(ChatContractError);
    expect(() => parseArchiveDetail({
      archiveId: "66666666-6666-4666-8666-666666666666",
      chatId: "33333333-3333-4333-8333-333333333333",
      errandId: "44444444-4444-4444-8444-444444444444",
      requesterUserId: "22222222-2222-4222-8222-222222222222",
      courierUserId: "55555555-5555-4555-8555-555555555555",
      archivedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 2,
      messages: [],
    })).toThrow(ChatContractError);
  });
});
