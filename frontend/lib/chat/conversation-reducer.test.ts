import { describe, expect, it } from "vitest";
import type { ChatJoinData, MessageView } from "./contracts";
import { conversationReducer, initialConversationState, mergeCommittedMessages } from "./conversation-reducer";

const callerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const chatId = "33333333-3333-4333-8333-333333333333";

function message(sequence: number, senderUserId = otherId, status: "UNREAD" | "READ" = "UNREAD"): MessageView {
  return {
    messageId: `${String(sequence).padStart(8, "0")}-4444-4444-8444-444444444444`,
    sequence,
    senderUserId,
    content: `message ${sequence}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    status,
  };
}

const activeJoin: ChatJoinData = {
  chatId,
  state: "ACTIVE",
  closesAt: null,
  closeReason: null,
  latestSequence: 3,
};

describe("conversationReducer", () => {
  it("deduplicates and orders committed messages delivered out of order", () => {
    const merged = mergeCommittedMessages([message(2)], [message(3), message(1), message(2)]);
    expect(merged.messages.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(merged.conflict).toBe(false);
  });

  it("detects sequence gaps and conflicting IDs before data reaches the UI", () => {
    expect(mergeCommittedMessages([message(1)], [message(3)]).conflict).toBe(true);
    const conflicting = { ...message(2), messageId: message(1).messageId };
    expect(mergeCommittedMessages([message(1)], [conflicting]).conflict).toBe(true);
  });

  it("preserves a committed read receipt across acknowledgement/event races", () => {
    const synchronized = conversationReducer(initialConversationState, {
      type: "synchronized",
      messages: [message(1, callerId)],
      olderCursor: null,
      hasOlder: false,
      join: activeJoin,
    });
    const read = conversationReducer(synchronized, { type: "receipt", throughSequence: 1, callerUserId: callerId });
    const replayedUnreadEvent = conversationReducer(read, { type: "merge", messages: [message(1, callerId)] });
    expect(replayedUnreadEvent.messages[0]?.status).toBe("READ");
  });

  it("applies only monotonic deadline shortening and then transitions to the archive", () => {
    const synchronized = conversationReducer(initialConversationState, {
      type: "synchronized",
      messages: [],
      olderCursor: null,
      hasOlder: false,
      join: activeJoin,
    });
    const closing = conversationReducer(synchronized, {
      type: "closing",
      closing: { chatId, closesAt: "2026-01-01T03:00:00.000Z", closeReason: "ERRAND_DELIVERED" },
    });
    const laterIgnored = conversationReducer(closing, {
      type: "closing",
      closing: { chatId, closesAt: "2026-01-01T04:00:00.000Z", closeReason: "ERRAND_DELIVERED" },
    });
    expect(laterIgnored.join?.closesAt).toBe("2026-01-01T03:00:00.000Z");

    const archived = conversationReducer(laterIgnored, {
      type: "archived",
      archived: {
        chatId,
        archiveId: "55555555-5555-4555-8555-555555555555",
        archivedAt: "2026-01-01T03:00:01.000Z",
      },
    });
    expect(archived.connection).toBe("offline");
    expect(archived.archiveRecovery).toBe("idle");
  });
});
