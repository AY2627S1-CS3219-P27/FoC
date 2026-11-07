"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { findArchiveByChatId, findLiveChatById, getMessageHistory } from "./api";
import {
  parseChatArchivedEvent,
  parseChatClosingEvent,
  parseChatJoinData,
  parseChatSocketAcknowledgement,
  parseMessageView,
  parseMessagesReadData,
  parseMessagesReadReceipt,
  type ChatSocketAcknowledgement,
  type MessageView,
} from "./contracts";
import { conversationReducer, initialConversationState, type PendingSend } from "./conversation-reducer";

const PAGE_SIZE = 50;
const ACK_TIMEOUT_MS = 8_000;

type ClientEvents = {
  "chat:join": (payload: { chatId: string }, ack: (response: unknown) => void) => void;
  "message:send": (payload: { chatId: string; clientMessageId: string; content: string }, ack: (response: unknown) => void) => void;
  "messages:read": (payload: { chatId: string; throughSequence: number }, ack: (response: unknown) => void) => void;
};

type ServerEvents = {
  "message:new": (payload: unknown) => void;
  "messages:read-receipt": (payload: unknown) => void;
  "chat:closing": (payload: unknown) => void;
  "chat:archived": (payload: unknown) => void;
};

type ChatSocket = Socket<ServerEvents, ClientEvents>;

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message === "Chat not found"
    ? "This chat is unavailable."
    : "Unable to synchronize this conversation. Please try again.";
}

function emitWithAck<T>(
  socket: ChatSocket,
  event: "chat:join" | "message:send" | "messages:read",
  payload: object,
  parse: (value: unknown) => ChatSocketAcknowledgement<T>
): Promise<ChatSocketAcknowledgement<T>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("ACK_TIMEOUT")), ACK_TIMEOUT_MS);
    const done = (response: unknown) => {
      window.clearTimeout(timer);
      try {
        resolve(parse(response));
      } catch (error) {
        reject(error);
      }
    };
    if (event === "chat:join") socket.emit(event, payload as { chatId: string }, done);
    if (event === "message:send") {
      socket.emit(event, payload as { chatId: string; clientMessageId: string; content: string }, done);
    }
    if (event === "messages:read") {
      socket.emit(event, payload as { chatId: string; throughSequence: number }, done);
    }
  });
}

export function useChatConversation(chatId: string, callerUserId: string, socketPath: string) {
  const [state, dispatch] = useReducer(conversationReducer, initialConversationState);
  const socketRef = useRef<ChatSocket | null>(null);
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const syncingRef = useRef(false);
  const bufferedRef = useRef<MessageView[]>([]);
  const lastReadRef = useRef(0);
  const recoveringArchiveRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const synchronize = useCallback(async (socket: ChatSocket, generation: number) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    dispatch({ type: "connection", connection: "synchronizing" });
    try {
      const firstPage = await getMessageHistory(chatId, { direction: "backward", limit: PAGE_SIZE });
      const joined = await emitWithAck(socket, "chat:join", { chatId }, (value) =>
        parseChatSocketAcknowledgement(value, parseChatJoinData)
      );
      if (!joined.ok) throw new Error(joined.error.message);

      let page = firstPage;
      const highest = page.items.at(-1)?.sequence ?? 0;
      if (highest < joined.data.latestSequence) {
        page = await getMessageHistory(chatId, { direction: "backward", limit: PAGE_SIZE });
      }

      const existingFirst = stateRef.current.messages[0]?.sequence;
      const recovered = [...page.items];
      let cursor = page.nextCursor;
      let hasMore = page.hasMore;
      while (
        existingFirst !== undefined &&
        recovered[0] !== undefined &&
        recovered[0].sequence > existingFirst + 1 &&
        hasMore &&
        cursor
      ) {
        const older = await getMessageHistory(chatId, { direction: "backward", cursor, limit: PAGE_SIZE });
        recovered.unshift(...older.items);
        cursor = older.nextCursor;
        hasMore = older.hasMore;
      }

      if (generation !== generationRef.current) return;
      dispatch({ type: "synchronized", messages: recovered, olderCursor: cursor, hasOlder: hasMore, join: joined.data });
      if (bufferedRef.current.length > 0) {
        dispatch({ type: "merge", messages: bufferedRef.current });
        bufferedRef.current = [];
      }
    } catch (error) {
      if (generation === generationRef.current) {
        dispatch({ type: "error", message: safeMessage(error) });
        dispatch({ type: "connection", connection: socket.connected ? "offline" : "reconnecting" });
      }
    } finally {
      syncingRef.current = false;
    }
  }, [chatId]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    dispatch({ type: "reset" });
    bufferedRef.current = [];
    lastReadRef.current = 0;

    const socket: ChatSocket = io("/chat", {
      path: socketPath,
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => void synchronize(socket, generation));
    socket.on("disconnect", (reason) => {
      if (generation !== generationRef.current) return;
      dispatch({ type: "connection", connection: reason === "io client disconnect" ? "offline" : "reconnecting" });
    });
    socket.on("connect_error", () => dispatch({ type: "connection", connection: "reconnecting" }));
    socket.on("message:new", (value) => {
      try {
        const message = parseMessageView(value);
        if (syncingRef.current) bufferedRef.current.push(message);
        else {
          const highest = stateRef.current.messages.at(-1)?.sequence ?? 0;
          dispatch({ type: "merge", messages: [message] });
          if (highest > 0 && message.sequence > highest + 1) void synchronize(socket, generation);
        }
      } catch {
        void synchronize(socket, generation);
      }
    });
    socket.on("messages:read-receipt", (value) => {
      try {
        const receipt = parseMessagesReadReceipt(value);
        if (receipt.chatId === chatId && receipt.highestReadSequence !== null) {
          dispatch({ type: "receipt", throughSequence: receipt.highestReadSequence, callerUserId });
        }
      } catch {
        void synchronize(socket, generation);
      }
    });
    socket.on("chat:closing", (value) => {
      try {
        const closing = parseChatClosingEvent(value);
        if (closing.chatId === chatId) dispatch({ type: "closing", closing });
      } catch {
        // A malformed advisory event is ignored; HTTP/socket recovery remains authoritative.
      }
    });
    socket.on("chat:archived", (value) => {
      try {
        const archived = parseChatArchivedEvent(value);
        if (archived.chatId === chatId) {
          dispatch({ type: "archived", archived });
          socket.disconnect();
        }
      } catch {
        // A malformed advisory event is ignored; HTTP recovery remains authoritative.
      }
    });

    dispatch({ type: "connection", connection: "connecting" });
    void getMessageHistory(chatId, { direction: "backward", limit: PAGE_SIZE })
      .then(() => {
        if (generation === generationRef.current) socket.connect();
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        dispatch({ type: "error", message: safeMessage(error) });
        dispatch({ type: "connection", connection: "offline" });
      });
    return () => {
      generationRef.current += 1;
      syncingRef.current = false;
      bufferedRef.current = [];
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [callerUserId, chatId, socketPath, synchronize]);

  const loadOlder = useCallback(async () => {
    const cursor = stateRef.current.olderCursor;
    if (!cursor || stateRef.current.loadingOlder) return;
    dispatch({ type: "older-loading" });
    try {
      const page = await getMessageHistory(chatId, { direction: "backward", cursor, limit: PAGE_SIZE });
      dispatch({ type: "older-loaded", messages: page.items, olderCursor: page.nextCursor, hasOlder: page.hasMore });
    } catch {
      dispatch({ type: "error", message: "Unable to load older messages. Please try again." });
    }
  }, [chatId]);

  const attemptSend = useCallback(async (pending: PendingSend) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      dispatch({ type: "pending-state", clientMessageId: pending.clientMessageId, state: "failed" });
      return;
    }
    dispatch({ type: "pending-state", clientMessageId: pending.clientMessageId, state: "retrying" });
    try {
      const acknowledgement = await emitWithAck(
        socket,
        "message:send",
        { chatId, clientMessageId: pending.clientMessageId, content: pending.content },
        (value) => parseChatSocketAcknowledgement(value, parseMessageView)
      );
      if (!acknowledgement.ok) throw new Error(acknowledgement.error.message);
      dispatch({ type: "merge", messages: [acknowledgement.data] });
      dispatch({ type: "pending-remove", clientMessageId: pending.clientMessageId });
    } catch {
      dispatch({ type: "pending-state", clientMessageId: pending.clientMessageId, state: "failed" });
    }
  }, [chatId]);

  const send = useCallback((content: string) => {
    const pending: PendingSend = { clientMessageId: crypto.randomUUID(), content, state: "sending" };
    dispatch({ type: "pending-add", pending });
    void attemptSend(pending);
  }, [attemptSend]);

  const retry = useCallback((clientMessageId: string) => {
    const pending = stateRef.current.pending.find((item) => item.clientMessageId === clientMessageId);
    if (pending) void attemptSend(pending);
  }, [attemptSend]);

  useEffect(() => {
    if (state.connection !== "connected" || state.conflict) return;
    const throughSequence = state.messages.reduce(
      (highest, message) => message.senderUserId !== callerUserId ? Math.max(highest, message.sequence) : highest,
      0
    );
    if (throughSequence <= lastReadRef.current) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;
    lastReadRef.current = throughSequence;
    void emitWithAck(socket, "messages:read", { chatId, throughSequence }, (value) =>
      parseChatSocketAcknowledgement(value, parseMessagesReadData)
    ).then((acknowledgement) => {
      if (!acknowledgement.ok || acknowledgement.data.highestReadSequence === null) return;
      dispatch({ type: "read-through", throughSequence: acknowledgement.data.highestReadSequence, callerUserId });
      window.dispatchEvent(new CustomEvent("foc:chat-read", { detail: { chatId } }));
    }).catch(() => {
      lastReadRef.current = Math.min(lastReadRef.current, throughSequence - 1);
    });
  }, [callerUserId, chatId, state.conflict, state.connection, state.messages]);

  useEffect(() => {
    const socket = socketRef.current;
    if (state.conflict && socket?.connected) {
      void synchronize(socket, generationRef.current);
    }
  }, [state.conflict, synchronize]);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (socket.connected) void synchronize(socket, generationRef.current);
    else {
      dispatch({ type: "connection", connection: "connecting" });
      void getMessageHistory(chatId, { direction: "backward", limit: PAGE_SIZE })
        .then(() => socket.connect())
        .catch((error) => {
          dispatch({ type: "error", message: safeMessage(error) });
          dispatch({ type: "connection", connection: "offline" });
        });
    }
  }, [chatId, synchronize]);

  const recoverArchive = useCallback(async () => {
    if (recoveringArchiveRef.current || stateRef.current.archived !== null) return;
    const generation = generationRef.current;
    recoveringArchiveRef.current = true;
    dispatch({ type: "archive-recovery", recovery: "checking" });
    try {
      const liveChat = await findLiveChatById(chatId);
      if (generation !== generationRef.current) return;
      if (liveChat !== null) {
        const role = liveChat.requesterUserId === callerUserId
          ? "REQUESTER"
          : liveChat.courierUserId === callerUserId
            ? "COURIER"
            : null;
        if (role !== null) dispatch({ type: "participant-role", role });
        dispatch({ type: "errand-id", errandId: liveChat.errandId });
        if (liveChat.state === "GRACE" && liveChat.closesAt !== null && liveChat.closeReason !== null) {
          dispatch({
            type: "closing",
            closing: { chatId, closesAt: liveChat.closesAt, closeReason: liveChat.closeReason },
          });
          dispatch({
            type: "archive-recovery",
            recovery: Date.now() >= Date.parse(liveChat.closesAt) ? "waiting" : "idle",
          });
        } else {
          dispatch({ type: "archive-recovery", recovery: "idle" });
        }
        return;
      }

      const archive = await findArchiveByChatId(chatId);
      if (generation !== generationRef.current) return;
      if (archive === null) {
        dispatch({ type: "archive-recovery", recovery: "waiting" });
        return;
      }
      const role = archive.requesterUserId === callerUserId
        ? "REQUESTER"
        : archive.courierUserId === callerUserId
          ? "COURIER"
          : null;
      if (role !== null) dispatch({ type: "participant-role", role });
      dispatch({ type: "errand-id", errandId: archive.errandId });
      dispatch({
        type: "archived",
        archived: { chatId, archiveId: archive.archiveId, archivedAt: archive.archivedAt },
      });
      socketRef.current?.disconnect();
    } catch {
      if (generation === generationRef.current) {
        dispatch({ type: "archive-recovery", recovery: "waiting" });
      }
    } finally {
      recoveringArchiveRef.current = false;
    }
  }, [callerUserId, chatId]);

  return { state, send, retry, loadOlder, reconnect, recoverArchive };
}
