"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, List, ListRow, LoadMore, PageHeader, Pill, SkeletonList } from "@/components/ui/layout";
import { getChats } from "@/lib/chat/api";
import type { ChatView } from "@/lib/chat/contracts";
import { formatErrandTitle, useChatErrand } from "@/lib/chat/use-chat-errand";
import { useDisplayName } from "@/lib/users/names";
import { ChatSwitch } from "../_shell/chat-switch";
import { useHomeContext } from "../_shell/home-shell";

const PAGE_SIZE = 20;

// Today shows the time, this week the weekday, anything older the date: the way Messages stamps its list.
function formatListTime(value: string): string {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (new Date().toDateString() === date.toDateString()) return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
  if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function counterpartFor(chat: ChatView, callerId: string): { role: "Requester" | "Courier"; userId: string } {
  const mine = chat.requesterUserId === callerId;
  return { role: mine ? "Courier" : "Requester", userId: mine ? chat.courierUserId : chat.requesterUserId };
}

function ChatListRow({ chat, callerId }: { chat: ChatView; callerId: string }) {
  const errand = useChatErrand(chat.errandId);
  const title = formatErrandTitle(errand, `Errand ${chat.errandId.slice(0, 8)}`);
  const counterpart = counterpartFor(chat, callerId);
  const counterpartName = useDisplayName(counterpart.userId);
  const heading = counterpartName ?? counterpart.role;
  const preview = chat.lastMessage?.content ?? "No messages yet";

  return (
    <ListRow
      href={`/home/chats/${chat.chatId}`}
      chevron
      leading={<Avatar url={null} name={heading} size={44} />}
      title={
        <span className="flex items-center gap-2">
          <span className={chat.unread ? "truncate font-semibold" : "truncate"}>{heading}</span>
          {chat.unread && <span className="size-2.5 shrink-0 rounded-full bg-nus-orange" role="img" aria-label="Unread messages" />}
        </span>
      }
      subtitle={
        <>
          <span className={`line-clamp-1 ${chat.unread ? "font-medium text-foreground" : ""}`}>{preview}</span>
          <span title={title} className="mt-0.5 line-clamp-1 text-xs">
            {counterpart.role} · {title}
          </span>
        </>
      }
      detail={
        <span className="flex flex-col items-end gap-1 text-[13px]">
          <time dateTime={chat.updatedAt}>{formatListTime(chat.updatedAt)}</time>
          {chat.state === "GRACE" && <Pill tone="orange">Closing soon</Pill>}
        </span>
      }
    />
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

  // A refresh keeps the rows on screen; only the very first load shows the skeleton.
  const firstLoad = loading && chats.length === 0;

  return (
    <section aria-labelledby="chats-heading" className="fade-in">
      <PageHeader
        title="Chats"
        subtitle="Private conversations for accepted errands."
        actions={
          <Button intent="outline" size="sm" onClick={() => void loadFirstPage()} disabled={loading}>
            {loading && !firstLoad ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <ChatSwitch current="chats" />

      {firstLoad && <SkeletonList count={4} />}
      {error && chats.length === 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface">
          <EmptyState
            tone="error"
            title="Could not load chats"
            body={error}
            action={
              <Button intent="tinted" size="sm" onClick={() => void loadFirstPage()}>
                Try again
              </Button>
            }
          />
        </div>
      )}
      {error && chats.length > 0 && (
        <p role="alert" className="mb-3 px-4 text-[13px] text-danger">
          {error}
        </p>
      )}
      {!loading && chats.length === 0 && !error && (
        <div className="overflow-hidden rounded-2xl bg-surface">
          <EmptyState title="No active chats" body="A chat appears here after an errand is accepted and processed." />
        </div>
      )}

      {chats.length > 0 && (
        <List>
          {chats.map((chat) => (
            <ChatListRow key={chat.chatId} chat={chat} callerId={user.uuid} />
          ))}
        </List>
      )}

      <LoadMore
        noun="chats"
        shown={chats.length}
        total={null}
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={() => void loadMore()}
      />
    </section>
  );
}
