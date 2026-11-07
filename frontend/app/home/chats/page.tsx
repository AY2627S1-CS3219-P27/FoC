"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getChats } from "@/lib/chat/api";
import type { ChatView } from "@/lib/chat/contracts";
import { formatErrandTitle, useChatErrand } from "@/lib/chat/use-chat-errand";
import { useDisplayName } from "@/lib/users/names";
import { useHomeContext } from "../_shell/home-shell";

const PAGE_SIZE = 20;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function roleFor(chat: ChatView, callerId: string): string {
  return chat.requesterUserId === callerId ? "Requester" : "Courier";
}

function counterpartFor(chat: ChatView, callerId: string): { role: "Requester" | "Courier"; userId: string } {
  const role = chat.requesterUserId === callerId ? "Courier" : "Requester";
  const userId = chat.requesterUserId === callerId ? chat.courierUserId : chat.requesterUserId;
  return { role, userId };
}

function ChatListRow({ chat, callerId }: { chat: ChatView; callerId: string }) {
  const errand = useChatErrand(chat.errandId);
  const title = formatErrandTitle(errand, `Errand ${chat.errandId.slice(0, 8)}`);
  const counterpart = counterpartFor(chat, callerId);
  const counterpartName = useDisplayName(counterpart.userId);
  const heading = counterpartName ?? counterpart.role;
  return (
    <li>
      <Link href={`/home/chats/${chat.chatId}`} className="card-press block rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-nus-orange">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{heading}</h2>
              {chat.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-nus-orange" aria-label="Unread messages" />}
            </div>
            <p title={title} className="mt-1 truncate text-xs text-muted">You are the {roleFor(chat, callerId).toLowerCase()} · {title}</p>
            <p className={`mt-3 truncate text-sm ${chat.unread ? "font-semibold" : "text-muted"}`}>{chat.lastMessage?.content ?? "No messages yet"}</p>
          </div>
          <div className="shrink-0 text-right">
            <time dateTime={chat.updatedAt} className="text-xs text-muted">{formatTime(chat.updatedAt)}</time>
            {chat.state === "GRACE" && <p className="mt-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Closing soon</p>}
          </div>
        </div>
      </Link>
    </li>
  );
}

export default function ChatsPage() {
  const { user } = useHomeContext();
  const [chats, setChats] = useState<ChatView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getChats({ limit: PAGE_SIZE });
      setChats(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Unable to load chats. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadFirstPage(), 0);
    const refresh = () => void loadFirstPage();
    const focus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("foc:chat-read", refresh);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("foc:chat-read", refresh);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [loadFirstPage]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getChats({ cursor, limit: PAGE_SIZE });
      setChats((current) => {
        const known = new Set(current.map((chat) => chat.chatId));
        return [...current, ...page.items.filter((chat) => !known.has(chat.chatId))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Unable to load more chats. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="chats-heading" className="fade-in mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 id="chats-heading" className="text-2xl font-bold">Chats</h1>
          <p className="mt-1 text-sm text-muted">Private conversations for accepted errands.</p>
        </div>
        <button type="button" onClick={() => void loadFirstPage()} disabled={loading} className="btn-press rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
          Refresh
        </button>
      </div>

      {loading && <p role="status" className="mt-8 text-sm text-muted">Loading chats…</p>}
      {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">{error}</div>}
      {!loading && chats.length === 0 && !error && (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <h2 className="font-semibold">No active chats</h2>
          <p className="mt-2 text-sm text-muted">A chat appears here after an errand is accepted and processed.</p>
        </div>
      )}

      {chats.length > 0 && (
        <ul className="mt-6 space-y-3" aria-label="Active chats">
          {chats.map((chat) => (
            <ChatListRow key={chat.chatId} chat={chat} callerId={user.uuid} />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-press rounded-lg bg-nus-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {loadingMore ? "Loading…" : "Load more chats"}
          </button>
        </div>
      )}
    </section>
  );
}
