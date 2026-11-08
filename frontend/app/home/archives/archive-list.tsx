"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, List, ListRow, PageHeader, SkeletonList } from "@/components/ui/layout";
import { getArchives } from "@/lib/chat/api";
import type { ArchiveListItem } from "@/lib/chat/contracts";
import { formatErrandTitle, useChatErrand } from "@/lib/chat/use-chat-errand";
import { useDisplayName } from "@/lib/users/names";
import { ChatSwitch } from "../_shell/chat-switch";
import { useHomeContext } from "../_shell/home-shell";

const PAGE_SIZE = 20;

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function callerRole(archive: ArchiveListItem, callerId: string): "Requester" | "Courier" {
  return archive.requesterUserId === callerId ? "Requester" : "Courier";
}

function ArchiveListRow({ archive, callerId }: { archive: ArchiveListItem; callerId: string }) {
  const errand = useChatErrand(archive.errandId);
  const title = formatErrandTitle(errand, `Errand ${archive.errandId.slice(0, 8)}`);
  const role = callerRole(archive, callerId);
  const counterpartRole = role === "Requester" ? "Courier" : "Requester";
  const counterpartId = role === "Requester" ? archive.courierUserId : archive.requesterUserId;
  const counterpartName = useDisplayName(counterpartId);
  const counterpartLabel = counterpartName ?? counterpartRole;
  return (
    <ListRow
      href={`/home/archives/${archive.archiveId}`}
      chevron
      leading={<Avatar url={null} name={counterpartLabel} size={44} />}
      title={<span title={title} className="line-clamp-1">{title}</span>}
      subtitle={`You were the ${role.toLowerCase()} · ${counterpartLabel}`}
      detail={
        <span className="text-[13px]">
          <span className="sr-only">Archived </span>
          <time dateTime={archive.archivedAt}>{formatTimestamp(archive.archivedAt)}</time>
        </span>
      }
    />
  );
}

export function ArchiveList() {
  const { user } = useHomeContext();
  const [archives, setArchives] = useState<ArchiveListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getArchives({ limit: PAGE_SIZE });
      setArchives(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Unable to load archived chats. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadFirstPage(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadFirstPage]);

  async function loadMore() {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getArchives({ cursor, limit: PAGE_SIZE });
      setArchives((current) => {
        const known = new Set(current.map((archive) => archive.archiveId));
        return [...current, ...page.items.filter((archive) => !known.has(archive.archiveId))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Unable to load more archived chats. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const firstLoad = loading && archives.length === 0;

  return (
    <section aria-labelledby="archives-heading" className="fade-in">
      <PageHeader
        title="Archives"
        subtitle="Completed conversations, preserved as read-only snapshots."
        actions={
          <Button intent="outline" size="sm" onClick={() => void loadFirstPage()} disabled={loading}>
            {loading && !firstLoad ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <ChatSwitch current="archives" />

      {firstLoad && <SkeletonList count={4} />}
      {error && archives.length === 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface">
          <EmptyState
            tone="error"
            title="Could not load archives"
            body={error}
            action={<Button intent="tinted" size="sm" onClick={() => void loadFirstPage()}>Try again</Button>}
          />
        </div>
      )}
      {error && archives.length > 0 && <p role="alert" className="mb-3 px-4 text-[13px] text-danger">{error}</p>}
      {!loading && archives.length === 0 && !error && (
        <div className="overflow-hidden rounded-2xl bg-surface">
          <EmptyState title="No archived chats" body="Chats appear here after their closing period ends and the archive is created." />
        </div>
      )}

      {archives.length > 0 && (
        <List>
          {archives.map((archive) => (
            <ArchiveListRow key={archive.archiveId} archive={archive} callerId={user.uuid} />
          ))}
        </List>
      )}

      {hasMore && (
        <div className="mt-5 flex justify-center">
          <Button intent="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more archives"}
          </Button>
        </div>
      )}
    </section>
  );
}
