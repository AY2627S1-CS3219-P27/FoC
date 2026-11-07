"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatConversation } from "@/lib/chat/use-chat-conversation";
import { useHomeContext } from "../../_shell/home-shell";

const MAX_MESSAGE_LENGTH = 4_000;
const ARCHIVE_RECOVERY_INTERVAL_MS = 5_000;
const LIFECYCLE_RECONCILIATION_INTERVAL_MS = 30_000;

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`
    : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

const closeReasonLabels = {
  ERRAND_DELIVERED: "The errand was delivered",
  COURIER_CANCELLED: "The courier cancelled",
  ERRAND_CANCELLED: "The errand was cancelled",
} as const;

const connectionLabels = {
  loading: "Loading conversation…",
  connecting: "Connecting…",
  synchronizing: "Synchronizing messages…",
  connected: "Connected",
  reconnecting: "Connection lost. Reconnecting…",
  offline: "Offline",
} as const;

export function ChatConversation({ chatId }: { chatId: string }) {
  const { user, socketPath } = useHomeContext();
  const { state, send, retry, loadOlder, reconnect, recoverArchive } = useChatConversation(chatId, user.uuid, socketPath);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);
  const previousLastSequence = useRef(0);

  useEffect(() => {
    const lastSequence = state.messages.at(-1)?.sequence ?? 0;
    if (lastSequence > previousLastSequence.current) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      previousLastSequence.current = lastSequence;
    }
  }, [state.messages]);

  const closesAt = state.join?.state === "GRACE" && state.join.closesAt ? Date.parse(state.join.closesAt) : null;
  const graceExpired = closesAt !== null && now >= closesAt;

  useEffect(() => {
    if (closesAt === null || state.archived !== null) return;
    const countdown = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(countdown);
  }, [closesAt, state.archived]);

  useEffect(() => {
    if (!graceExpired || state.archived !== null) return;
    void recoverArchive();
    const recovery = window.setInterval(() => void recoverArchive(), ARCHIVE_RECOVERY_INTERVAL_MS);
    return () => window.clearInterval(recovery);
  }, [graceExpired, recoverArchive, state.archived]);

  useEffect(() => {
    if (state.archived !== null) return;
    const reconcile = () => {
      if (document.visibilityState === "visible") void recoverArchive();
    };
    reconcile();
    const lifecycle = window.setInterval(reconcile, LIFECYCLE_RECONCILIATION_INTERVAL_MS);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.clearInterval(lifecycle);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [recoverArchive, state.archived]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      draft.trim().length === 0 ||
      [...draft].length > MAX_MESSAGE_LENGTH ||
      state.connection !== "connected" ||
      graceExpired
    ) return;
    send(draft);
    setDraft("");
  }

  const composerDisabled = state.connection !== "connected" || state.archived !== null || graceExpired;

  return (
    <section aria-labelledby="conversation-heading" className="fade-in mx-auto flex min-h-[calc(100vh-9rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border bg-background p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href="/home/chats" className="text-sm font-medium text-nus-blue hover:underline">← All chats</Link>
            <h1 id="conversation-heading" className="mt-1 truncate text-xl font-bold">Errand chat</h1>
            <p className="truncate text-xs text-muted">Chat {chatId}</p>
          </div>
          <div className="text-right">
            <p role="status" className={`text-sm font-medium ${state.connection === "connected" ? "text-success" : "text-muted"}`}>{connectionLabels[state.connection]}</p>
            {(state.connection === "offline" || state.error) && !state.archived && (
              <button type="button" onClick={reconnect} className="mt-1 text-sm font-medium text-nus-blue hover:underline">Retry connection</button>
            )}
          </div>
        </div>
      </header>

      {state.error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">{state.error}</p>}
      {state.archived && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This conversation was archived at {formatTimestamp(state.archived.archivedAt)}.{" "}
          <Link className="font-semibold underline" href={`/home/archives/${state.archived.archiveId}`}>View the read-only archive</Link>
        </div>
      )}
      {state.join?.state === "GRACE" && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">{state.join.closeReason ? closeReasonLabels[state.join.closeReason] : "This chat is closing"}.</p>
          <p className="mt-1">
            Deadline: <time dateTime={state.join.closesAt ?? undefined}>{state.join.closesAt ? formatTimestamp(state.join.closesAt) : "being confirmed"}</time>
            {closesAt !== null && !graceExpired && <> · <span role="timer">{formatCountdown(closesAt - now)} remaining</span></>}
          </p>
          {graceExpired && !state.archived && (
            <p role="status" className="mt-1 font-medium">
              The closing period has ended. {state.archiveRecovery === "checking" ? "Checking for the archive…" : "Waiting for the read-only archive…"}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-background px-4 py-5" aria-live="polite">
        {state.hasOlder && (
          <div className="mb-5 text-center">
            <button type="button" onClick={() => void loadOlder()} disabled={state.loadingOlder} className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
              {state.loadingOlder ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}
        {state.messages.length === 0 && state.connection === "connected" && <p className="py-12 text-center text-sm text-muted">No messages yet. Start the conversation below.</p>}
        <ol className="space-y-3" aria-label="Messages">
          {state.messages.map((message) => {
            const mine = message.senderUserId === user.uuid;
            return (
              <li key={message.messageId} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <article className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[70%] ${mine ? "bg-nus-blue text-white" : "border border-border bg-surface"}`}>
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                  <div className={`mt-1 flex items-center gap-2 text-xs ${mine ? "text-white/70" : "text-muted"}`}>
                    <time dateTime={message.timestamp}>{formatTimestamp(message.timestamp)}</time>
                    {mine && <span>{message.status === "READ" ? "Read" : "Sent"}</span>}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>

        {state.pending.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Pending messages">
            {state.pending.map((pending) => (
              <li key={pending.clientMessageId} className="ml-auto max-w-[85%] rounded-2xl border border-dashed border-border bg-surface px-4 py-3 sm:max-w-[70%]">
                <p className="whitespace-pre-wrap break-words text-sm text-muted">{pending.content}</p>
                <div className="mt-1 flex items-center justify-end gap-2 text-xs text-muted">
                  <span>{pending.state === "failed" ? "Not sent" : "Sending…"}</span>
                  {pending.state === "failed" && <button type="button" className="font-semibold text-nus-blue hover:underline" onClick={() => retry(pending.clientMessageId)}>Retry</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-border bg-background p-4">
        <label htmlFor="chat-message" className="sr-only">Message</label>
        <div className="flex items-end gap-3">
          <textarea
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={composerDisabled}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH * 2}
            placeholder={graceExpired ? "Closing period ended—waiting for archive" : composerDisabled ? "Connect to send messages" : "Write a message"}
            className="min-h-12 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60"
          />
          <button type="submit" disabled={composerDisabled || draft.trim().length === 0 || [...draft].length > MAX_MESSAGE_LENGTH} className="btn-press rounded-xl bg-nus-orange px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </div>
        <p className="mt-1 text-right text-xs text-muted">{[...draft].length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}</p>
      </form>
    </section>
  );
}
