"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatApiError, getArchive } from "@/lib/chat/api";
import type { ArchiveDetail } from "@/lib/chat/contracts";
import { useHomeContext } from "../../_shell/home-shell";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ArchiveDetailView({ archiveId }: { archiveId: string }) {
  const { user } = useHomeContext();
  const [archive, setArchive] = useState<ArchiveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void getArchive(archiveId)
      .then((value) => {
        if (active) setArchive(value);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof ChatApiError && cause.status === 404 ? "This archive is unavailable." : "Unable to load this archive. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archiveId, attempt]);

  function retry() {
    setArchive(null);
    setError(null);
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  if (loading) return <p role="status" className="fade-in text-sm text-muted">Loading archive…</p>;
  if (error || archive === null) {
    return (
      <section className="fade-in mx-auto max-w-3xl">
        <Link href="/home/archives" className="text-sm font-medium text-nus-blue hover:underline">← All archives</Link>
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">
          <p>{error ?? "This archive is unavailable."}</p>
          {error !== "This archive is unavailable." && <button type="button" onClick={retry} className="mt-2 font-semibold text-nus-blue hover:underline">Try again</button>}
        </div>
      </section>
    );
  }

  const callerRole = archive.requesterUserId === user.uuid ? "REQUESTER" : "COURIER";

  return (
    <section aria-labelledby="archive-heading" className="fade-in mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border bg-background p-4 sm:p-5">
        <Link href="/home/archives" className="text-sm font-medium text-nus-blue hover:underline">← All archives</Link>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 id="archive-heading" className="text-xl font-bold">Archived errand chat</h1>
            <p className="mt-1 text-sm text-muted">Errand {archive.errandId} · You were the {callerRole.toLowerCase()}.</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Archived</p>
            <time dateTime={archive.archivedAt} className="text-sm">{formatTimestamp(archive.archivedAt)}</time>
          </div>
        </div>
        <p role="status" className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">This is an immutable snapshot. Messages cannot be sent, edited, deleted, or restored.</p>
      </header>

      <div className="bg-background px-4 py-5 sm:px-5">
        {archive.messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No messages were recorded in this conversation.</p>
        ) : (
          <ol className="space-y-3" aria-label="Archived messages">
            {archive.messages.map((message, index) => {
              const mine = message.role === callerRole;
              return (
                <li key={`${message.timestamp}-${index}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <article className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[70%] ${mine ? "bg-nus-blue text-white" : "border border-border bg-surface"}`}>
                    <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${mine ? "text-white/70" : "text-muted"}`}>{mine ? `You · ${message.role.toLowerCase()}` : message.role.toLowerCase()}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                    <time dateTime={message.timestamp} className={`mt-1 block text-xs ${mine ? "text-white/70" : "text-muted"}`}>{formatTimestamp(message.timestamp)}</time>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
