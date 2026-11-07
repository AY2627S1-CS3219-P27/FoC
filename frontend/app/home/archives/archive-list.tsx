"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getArchives } from "@/lib/chat/api";
import type { ArchiveListItem } from "@/lib/chat/contracts";
import { formatErrandTitle, useChatErrand } from "@/lib/chat/use-chat-errand";
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
  const counterpartId = role === "Requester" ? archive.courierUserId : archive.requesterUserId;
  return (
    <li>
      <Link href={`/home/archives/${archive.archiveId}`} className="card-press block rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-nus-orange">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <h2 title={title} className="truncate font-semibold">{title}</h2>
            <p className="mt-1 truncate text-sm text-muted">You were the {role.toLowerCase()} · {role === "Requester" ? "Courier" : "Requester"} {counterpartId.slice(0, 8)}</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Archived</p>
            <time dateTime={archive.archivedAt} className="text-sm">{formatTimestamp(archive.archivedAt)}</time>
          </div>
        </div>
      </Link>
    </li>
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

  return (
    <section aria-labelledby="archives-heading" className="fade-in mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 id="archives-heading" className="text-2xl font-bold">Archives</h1>
          <p className="mt-1 text-sm text-muted">Completed conversations, preserved as read-only snapshots.</p>
        </div>
        <button type="button" onClick={() => void loadFirstPage()} disabled={loading} className="btn-press rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">Refresh</button>
      </div>

      {loading && <p role="status" className="mt-8 text-sm text-muted">Loading archives…</p>}
      {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">{error}</div>}
      {!loading && archives.length === 0 && !error && (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <h2 className="font-semibold">No archived chats</h2>
          <p className="mt-2 text-sm text-muted">Chats appear here after their closing period ends and the archive is created.</p>
        </div>
      )}

      {archives.length > 0 && (
        <ol className="mt-6 space-y-3" aria-label="Archived chats, newest first">
          {archives.map((archive) => (
            <ArchiveListRow key={archive.archiveId} archive={archive} callerId={user.uuid} />
          ))}
        </ol>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-press rounded-lg bg-nus-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loadingMore ? "Loading…" : "Load more archives"}</button>
        </div>
      )}
    </section>
  );
}
