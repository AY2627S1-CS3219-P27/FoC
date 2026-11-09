"use client";

import { authFetch } from "@/lib/api";
import {
  parseArchiveDetail,
  parseArchiveListResponse,
  parseChatListResponse,
  parseChatView,
  parseMessageHistoryResponse,
  type ArchiveDetail,
  type ArchiveListResponse,
  type ChatView,
  type ChatListResponse,
  type MessageHistoryDirection,
  type MessageHistoryResponse,
} from "./contracts";

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

interface PageOptions {
  cursor?: string;
  limit?: number;
}

function pageQuery(options: PageOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  return query;
}

function withQuery(path: string, query: URLSearchParams): string {
  const suffix = query.toString();
  return suffix === "" ? path : `${path}?${suffix}`;
}

async function request<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await authFetch(path);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    throw new ChatApiError(
      response.status,
      typeof error.code === "string" ? error.code : "CHAT_REQUEST_FAILED",
      typeof error.message === "string" ? error.message : "Unable to load chat data"
    );
  }
  return parse(body);
}

export function getChats(options: PageOptions = {}): Promise<ChatListResponse> {
  return request(withQuery("/api/chats", pageQuery(options)), parseChatListResponse);
}

export function getChat(chatId: string): Promise<ChatView> {
  return request(`/api/chats/${encodeURIComponent(chatId)}`, parseChatView);
}

export function getMessageHistory(
  chatId: string,
  options: PageOptions & { direction?: MessageHistoryDirection } = {}
): Promise<MessageHistoryResponse> {
  const query = pageQuery(options);
  if (options.direction !== undefined) {
    query.set("direction", options.direction);
  }
  return request(withQuery(`/api/chats/${encodeURIComponent(chatId)}/messages`, query), parseMessageHistoryResponse);
}

export function getArchives(options: PageOptions = {}): Promise<ArchiveListResponse> {
  return request(withQuery("/api/chats/archives", pageQuery(options)), parseArchiveListResponse);
}

export function getArchive(archiveId: string): Promise<ArchiveDetail> {
  return request(`/api/chats/archives/${encodeURIComponent(archiveId)}`, parseArchiveDetail);
}

export async function findArchiveByChatId(chatId: string) {
  let cursor: string | undefined;
  const visited = new Set<string>();

  do {
    const page = await getArchives({ cursor, limit: 50 });
    const archive = page.items.find((item) => item.chatId === chatId);
    if (archive) return archive;
    if (!page.hasMore || page.nextCursor === null || visited.has(page.nextCursor)) return null;
    visited.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  return null;
}

// null means the chat is not live for this caller (archived, absent or not theirs); other failures throw.
export async function findLiveChatById(chatId: string): Promise<ChatView | null> {
  try {
    return await getChat(chatId);
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 404) return null;
    throw error;
  }
}
