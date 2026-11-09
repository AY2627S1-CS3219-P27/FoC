"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { EmptyState, PageHeader, SkeletonList } from "@/components/ui/layout";
import { ChatApiError, getArchive } from "@/lib/chat/api";
import type { ArchiveDetail } from "@/lib/chat/contracts";
import { useDisplayName } from "@/lib/users/names";
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
  const counterpartUserId = archive !== null ? (archive.requesterUserId === user.uuid ? archive.courierUserId : archive.requesterUserId) : null;
  const counterpartName = useDisplayName(counterpartUserId);

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

  const back = (
    <Link href="/home/archives" className="inline-flex items-center gap-0.5 text-[15px] text-nus-orange">
      <ChevronLeftIcon size={18} strokeWidth={2.4} />
      Archived
    </Link>
  );

  if (loading) return <div className="fade-in"><SkeletonList count={3} /></div>;
  if (error || archive === null) {
    return (
      <section className="fade-in">
        <div className="mb-3">{back}</div>
        <div className="overflow-hidden rounded-2xl bg-surface">
          <EmptyState
            tone="error"
            title={error ?? "This archive is unavailable."}
            action={
              error !== "This archive is unavailable." ? (
                <Button intent="tinted" size="sm" onClick={retry}>Try again</Button>
              ) : undefined
            }
          />
        </div>
      </section>
    );
  }

  const callerRole = archive.requesterUserId === user.uuid ? "REQUESTER" : "COURIER";

  return (
    <section aria-labelledby="archive-heading" className="fade-in">
      <div className="mb-3">{back}</div>
      <PageHeader
        title="Archived chat"
        subtitle={`Errand ${archive.errandId.slice(0, 8)} · You were the ${callerRole.toLowerCase()}${counterpartName ? ` with ${counterpartName}` : ""}`}
      />
      <p id="archive-heading" className="sr-only">Archived errand chat</p>
      <p role="status" className="mb-4 rounded-xl bg-fill px-4 py-2.5 text-[13px] text-muted">
        Archived <time dateTime={archive.archivedAt}>{formatTimestamp(archive.archivedAt)}</time>. This is an immutable snapshot: messages cannot be sent, edited, deleted, or restored.
      </p>

      <div className="rounded-2xl bg-surface px-4 py-5">
        {archive.messages.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-muted">No messages were recorded in this conversation.</p>
        ) : (
          <ol className="space-y-2" aria-label="Archived messages">
            {archive.messages.map((message, index) => {
              const mine = message.role === callerRole;
              return (
                <li key={`${message.timestamp}-${index}`} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <article className={`max-w-[85%] rounded-[20px] px-3.5 py-2 sm:max-w-[70%] ${mine ? "bg-nus-blue text-white" : "bg-fill"}`}>
                    <p className="whitespace-pre-wrap break-words text-[15px]">{message.content}</p>
                  </article>
                  <p className="mt-0.5 px-2 text-[11px] text-muted">
                    {mine ? "You" : (counterpartName ?? message.role.toLowerCase())} · <time dateTime={message.timestamp}>{formatTimestamp(message.timestamp)}</time>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
