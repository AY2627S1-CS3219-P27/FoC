import type { ChatArchivedEvent, ChatClosingEvent, ChatJoinData, MessageView } from "./contracts";

export type ConnectionState = "loading" | "connecting" | "synchronizing" | "connected" | "reconnecting" | "offline";
export type PendingSendState = "sending" | "retrying" | "failed";
export type ArchiveRecoveryState = "idle" | "checking" | "waiting";
export type ParticipantRole = "REQUESTER" | "COURIER";

export interface PendingSend {
  clientMessageId: string;
  content: string;
  state: PendingSendState;
}

export interface ConversationState {
  messages: MessageView[];
  olderCursor: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  pending: PendingSend[];
  connection: ConnectionState;
  join: ChatJoinData | null;
  archived: ChatArchivedEvent | null;
  archiveRecovery: ArchiveRecoveryState;
  participantRole: ParticipantRole | null;
  errandId: string | null;
  error: string | null;
  conflict: boolean;
}

export const initialConversationState: ConversationState = {
  messages: [],
  olderCursor: null,
  hasOlder: false,
  loadingOlder: false,
  pending: [],
  connection: "loading",
  join: null,
  archived: null,
  archiveRecovery: "idle",
  participantRole: null,
  errandId: null,
  error: null,
  conflict: false,
};

export type ConversationAction =
  | { type: "reset" }
  | { type: "connection"; connection: ConnectionState }
  | { type: "synchronized"; messages: MessageView[]; olderCursor: string | null; hasOlder: boolean; join: ChatJoinData }
  | { type: "merge"; messages: MessageView[] }
  | { type: "older-loading" }
  | { type: "older-loaded"; messages: MessageView[]; olderCursor: string | null; hasOlder: boolean }
  | { type: "pending-add"; pending: PendingSend }
  | { type: "pending-state"; clientMessageId: string; state: PendingSendState }
  | { type: "pending-remove"; clientMessageId: string }
  | { type: "read-through"; throughSequence: number; callerUserId: string }
  | { type: "receipt"; throughSequence: number; callerUserId: string }
  | { type: "closing"; closing: ChatClosingEvent }
  | { type: "archive-recovery"; recovery: ArchiveRecoveryState }
  | { type: "participant-role"; role: ParticipantRole }
  | { type: "errand-id"; errandId: string }
  | { type: "archived"; archived: ChatArchivedEvent }
  | { type: "error"; message: string };

function sameMessage(left: MessageView, right: MessageView): boolean {
  return (
    left.messageId === right.messageId &&
    left.sequence === right.sequence &&
    left.senderUserId === right.senderUserId &&
    left.content === right.content &&
    left.timestamp === right.timestamp
  );
}

export function mergeCommittedMessages(current: MessageView[], incoming: MessageView[]) {
  const byId = new Map(current.map((message) => [message.messageId, message]));
  const bySequence = new Map(current.map((message) => [message.sequence, message]));
  let conflict = false;

  for (const message of incoming) {
    const idMatch = byId.get(message.messageId);
    const sequenceMatch = bySequence.get(message.sequence);
    if ((idMatch && !sameMessage(idMatch, message)) || (sequenceMatch && sequenceMatch.messageId !== message.messageId)) {
      conflict = true;
      continue;
    }
    const existing = idMatch ?? sequenceMatch;
    const merged = existing?.status === "READ" ? { ...message, status: "READ" as const } : message;
    byId.set(merged.messageId, merged);
    bySequence.set(merged.sequence, merged);
  }

  const messages = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
  const hasGap = messages.some((message, index) => index > 0 && message.sequence !== messages[index - 1]!.sequence + 1);
  return { messages, conflict: conflict || hasGap };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "reset":
      return initialConversationState;
    case "connection":
      return { ...state, connection: action.connection };
    case "synchronized": {
      const firstAuthoritativeSequence = action.messages[0]?.sequence;
      const retained =
        firstAuthoritativeSequence === undefined
          ? state.messages
          : state.messages.filter((message) => message.sequence < firstAuthoritativeSequence);
      const merged = mergeCommittedMessages(retained, action.messages);
      return {
        ...state,
        ...merged,
        olderCursor: action.olderCursor,
        hasOlder: action.hasOlder,
        join: action.join,
        connection: "connected",
        error: null,
      };
    }
    case "merge": {
      const merged = mergeCommittedMessages(state.messages, action.messages);
      return { ...state, ...merged };
    }
    case "older-loading":
      return { ...state, loadingOlder: true };
    case "older-loaded": {
      const merged = mergeCommittedMessages(state.messages, action.messages);
      return {
        ...state,
        ...merged,
        loadingOlder: false,
        olderCursor: action.olderCursor,
        hasOlder: action.hasOlder,
      };
    }
    case "pending-add":
      return { ...state, pending: [...state.pending, action.pending] };
    case "pending-state":
      return {
        ...state,
        pending: state.pending.map((pending) =>
          pending.clientMessageId === action.clientMessageId ? { ...pending, state: action.state } : pending
        ),
      };
    case "pending-remove":
      return { ...state, pending: state.pending.filter((pending) => pending.clientMessageId !== action.clientMessageId) };
    case "read-through":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.senderUserId !== action.callerUserId && message.sequence <= action.throughSequence
            ? { ...message, status: "READ" }
            : message
        ),
      };
    case "receipt":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.senderUserId === action.callerUserId && message.sequence <= action.throughSequence
            ? { ...message, status: "READ" }
            : message
        ),
      };
    case "closing": {
      if (state.join === null) return state;
      if (state.join.closesAt !== null && action.closing.closesAt > state.join.closesAt) return state;
      return {
        ...state,
        join: { ...state.join, state: "GRACE", ...action.closing },
      };
    }
    case "archive-recovery":
      return { ...state, archiveRecovery: action.recovery };
    case "participant-role":
      return { ...state, participantRole: action.role };
    case "errand-id":
      return { ...state, errandId: action.errandId };
    case "archived":
      return { ...state, archived: action.archived, archiveRecovery: "idle", connection: "offline", error: null };
    case "error":
      return { ...state, error: action.message, loadingOlder: false };
  }
}
