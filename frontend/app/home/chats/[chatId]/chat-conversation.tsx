"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowUpIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { useChatConversation } from "@/lib/chat/use-chat-conversation";
import { formatErrandTitle, useChatErrand } from "@/lib/chat/use-chat-errand";
import { useDisplayName } from "@/lib/users/names";
import { useHomeContext } from "../../_shell/home-shell";

const MAX_MESSAGE_LENGTH = 4_000;
const ARCHIVE_RECOVERY_INTERVAL_MS = 5_000;
const LIFECYCLE_RECONCILIATION_INTERVAL_MS = 30_000;
const BOTTOM_THRESHOLD_PX = 48;

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

// Day dividers and bubble grouping: a new divider after a long pause, a tight stack for a run from one sender.
const DIVIDER_GAP_MS = 15 * 60_000;

function formatDivider(value: string): string {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? time : `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}, ${time}`;
}

const COMPOSER_MAX_HEIGHT_PX = 132;

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
  const errand = useChatErrand(state.errandId);
  const roleLabel = state.participantRole === "REQUESTER" ? "Requester" : state.participantRole === "COURIER" ? "Courier" : null;
  const headingFallback = roleLabel ? `Errand chat · ${roleLabel}` : "Errand chat";
  const heading = formatErrandTitle(errand, headingFallback);
  const counterpartName = useDisplayName(state.counterpartUserId);
  const counterpartRoleLabel = state.participantRole === "REQUESTER" ? "Courier" : state.participantRole === "COURIER" ? "Requester" : null;
  const counterpartStatusLine = counterpartName
    ? `${counterpartName} is your ${(counterpartRoleLabel ?? "chat partner").toLowerCase()}.`
    : counterpartRoleLabel ?? "Participant";
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const transcriptInitializedRef = useRef(false);
  const previousLastSequence = useRef(0);

  useEffect(() => {
    const lastSequence = state.messages.at(-1)?.sequence ?? 0;
    const appended = lastSequence > previousLastSequence.current;
    const lastMessageIsMine = state.messages.at(-1)?.senderUserId === user.uuid;
    const shouldScroll =
      forceScrollRef.current ||
      (!transcriptInitializedRef.current && lastSequence > 0) ||
      (appended && (lastMessageIsMine || isAtBottomRef.current));

    previousLastSequence.current = lastSequence;
    forceScrollRef.current = false;
    if (!shouldScroll) return;

    const behavior = transcriptInitializedRef.current ? "smooth" : "auto";
    transcriptInitializedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (!transcript) return;
      transcript.scrollTo({ top: transcript.scrollHeight, behavior });
      isAtBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.messages, state.pending, user.uuid]);

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
    forceScrollRef.current = true;
    send(draft);
    setDraft("");
    const composer = document.getElementById("chat-message");
    if (composer) composer.style.height = "auto";
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function trackTranscriptPosition() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }

  const composerDisabled = state.connection !== "connected" || state.archived !== null || graceExpired;
  const draftLength = [...draft].length;
  const canSend = !composerDisabled && draft.trim().length > 0 && draftLength <= MAX_MESSAGE_LENGTH;
  const lastMineSequence = [...state.messages].reverse().find((m) => m.senderUserId === user.uuid)?.sequence;
  const connected = state.connection === "connected";
  const subtitle = counterpartName
    ? `${counterpartRoleLabel ?? "Chat partner"} · ${heading}`
    : errand
      ? counterpartStatusLine
      : `Chat ${chatId.slice(0, 8)}`;

  function resizeComposer(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    // scrollHeight excludes the border, but the box is border-sizing, so add it back or a 2px overflow draws a scrollbar.
    const border = element.offsetHeight - element.clientHeight;
    const wanted = element.scrollHeight + border;
    element.style.height = `${Math.min(wanted, COMPOSER_MAX_HEIGHT_PX)}px`;
    // Only scroll once the cap is reached.
    element.style.overflowY = wanted > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  return (
    <section
      aria-labelledby="conversation-heading"
      className="fade-in mx-auto flex h-dvh min-h-0 max-w-3xl flex-col overflow-hidden bg-background md:h-[calc(100dvh-5rem)] md:rounded-2xl md:border md:border-border md:bg-surface"
    >
      <header className="material-bar bar-edge shrink-0 border-b border-border pt-[env(safe-area-inset-top)]" data-scrolled>
        <div className="flex items-center gap-2 px-2 py-2 md:px-3">
          <Link
            href="/home/chats"
            aria-label="All chats"
            className="btn-press flex h-10 shrink-0 items-center rounded-full pr-2 pl-1 text-nus-orange"
          >
            <ChevronLeftIcon size={24} strokeWidth={2.4} />
            <span className="text-[15px] max-sm:sr-only">Chats</span>
          </Link>
          <Avatar url={null} name={counterpartName ?? counterpartRoleLabel ?? "Chat"} size={36} />
          <div className="min-w-0 flex-1">
            <h1 id="conversation-heading" title={counterpartName ?? heading} className="truncate text-[16px] leading-tight font-semibold">
              {counterpartName ?? heading}
            </h1>
            <p title={subtitle} className="truncate text-xs text-muted">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pr-1">
            <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <span
                aria-hidden="true"
                className={clsx("size-2 rounded-full", connected ? "bg-success" : state.connection === "offline" ? "bg-danger" : "bg-nus-orange")}
              />
              <span className={connected ? "sr-only" : "max-sm:sr-only"}>{connectionLabels[state.connection]}</span>
            </p>
            {(state.connection === "offline" || state.error) && !state.archived && (
              <Button intent="tinted" size="xs" onClick={reconnect}>Retry connection</Button>
            )}
          </div>
        </div>
        {errand && (
          <p title={`Collect: ${errand.collectionItems}`} className="truncate px-4 pb-2 text-xs text-muted md:px-5">
            Collect: {errand.collectionItems}
          </p>
        )}
      </header>

      {state.error && <p role="alert" className="shrink-0 bg-danger/10 px-4 py-2.5 text-[13px] text-danger">{state.error}</p>}
      {state.archived && (
        <div role="status" className="shrink-0 bg-fill px-4 py-2.5 text-[13px]">
          Archived {formatTimestamp(state.archived.archivedAt)}.{" "}
          <Link className="font-semibold text-nus-orange" href={`/home/archives/${state.archived.archiveId}`}>View the read-only archive</Link>
        </div>
      )}
      {state.join?.state === "GRACE" && (
        <div className="shrink-0 bg-nus-orange/12 px-4 py-2.5 text-[13px]">
          <p className="font-semibold">{state.join.closeReason ? closeReasonLabels[state.join.closeReason] : "This chat is closing"}.</p>
          <p className="mt-0.5 text-muted">
            Deadline: <time dateTime={state.join.closesAt ?? undefined}>{state.join.closesAt ? formatTimestamp(state.join.closesAt) : "being confirmed"}</time>
            {closesAt !== null && !graceExpired && <> · <span role="timer" className="tabular font-medium text-foreground">{formatCountdown(closesAt - now)} remaining</span></>}
          </p>
          {graceExpired && !state.archived && (
            <p role="status" className="mt-1 font-medium">
              The closing period has ended. {state.archiveRecovery === "checking" ? "Checking for the archive…" : "Waiting for the read-only archive…"}
            </p>
          )}
        </div>
      )}

      <div ref={transcriptRef} onScroll={trackTranscriptPosition} className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-3 py-4 md:px-5" aria-live="polite">
        {state.hasOlder && (
          <div className="mb-4 text-center">
            <Button intent="outline" size="sm" onClick={() => void loadOlder()} disabled={state.loadingOlder}>
              {state.loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        )}
        {state.messages.length === 0 && connected && <p className="py-12 text-center text-[15px] text-muted">No messages yet. Start the conversation below.</p>}
        <ol className="flex flex-col" aria-label="Messages">
          {state.messages.map((message, index) => {
            const mine = message.senderUserId === user.uuid;
            const previous = state.messages[index - 1];
            const next = state.messages[index + 1];
            const startsRun = !previous || previous.senderUserId !== message.senderUserId;
            const showDivider = !previous || Date.parse(message.timestamp) - Date.parse(previous.timestamp) > DIVIDER_GAP_MS;
            const endsRun = !next || next.senderUserId !== message.senderUserId;
            return (
              <li key={message.messageId} className={clsx("flex flex-col", mine ? "items-end" : "items-start", showDivider || startsRun ? "mt-3 first:mt-0" : "mt-0.5")}>
                {showDivider && (
                  <p className="mb-2 self-center text-[11px] font-medium text-muted" aria-hidden="true">{formatDivider(message.timestamp)}</p>
                )}
                <article
                  className={clsx(
                    "bubble-in max-w-[80%] rounded-[20px] px-3.5 py-2 sm:max-w-[70%]",
                    mine ? "origin-bottom-right bg-nus-blue text-white" : "origin-bottom-left bg-surface md:bg-fill",
                    mine && endsRun && "rounded-br-md",
                    !mine && endsRun && "rounded-bl-md",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words text-[15px]">{message.content}</p>
                  <time dateTime={message.timestamp} className="sr-only">{formatTimestamp(message.timestamp)}</time>
                </article>
                {mine && message.sequence === lastMineSequence && state.pending.length === 0 && (
                  <p className="mt-0.5 px-1 text-[11px] font-medium text-muted">{message.status === "READ" ? "Read" : "Sent"}</p>
                )}
              </li>
            );
          })}
        </ol>

        {state.pending.length > 0 && (
          <ul className="mt-0.5 flex flex-col items-end gap-0.5" aria-label="Pending messages">
            {state.pending.map((pending) => (
              <li key={pending.clientMessageId} className="flex max-w-[80%] flex-col items-end sm:max-w-[70%]">
                <div className={clsx("bubble-in origin-bottom-right rounded-[20px] rounded-br-md px-3.5 py-2", pending.state === "failed" ? "bg-danger/12" : "bg-nus-blue/60 text-white")}>
                  <p className={clsx("whitespace-pre-wrap break-words text-[15px]", pending.state === "failed" && "text-foreground")}>{pending.content}</p>
                </div>
                <p className="mt-0.5 flex items-center gap-2 px-1 text-[11px] font-medium text-muted">
                  <span className={pending.state === "failed" ? "text-danger" : undefined}>{pending.state === "failed" ? "Not sent" : "Sending…"}</span>
                  {pending.state === "failed" && <button type="button" className="font-semibold text-nus-orange" onClick={() => retry(pending.clientMessageId)}>Retry</button>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submit} className="material-bar shrink-0 border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:px-4">
        <label htmlFor="chat-message" className="sr-only">Message</label>
        <div className="flex items-end gap-2">
          <textarea
            id="chat-message"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              resizeComposer(event.target);
            }}
            onKeyDown={handleComposerKeyDown}
            disabled={composerDisabled}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH * 2}
            placeholder={graceExpired ? "Closing period ended, waiting for archive" : composerDisabled ? "Connect to send messages" : "Message"}
            className="max-h-[132px] min-h-10 flex-1 resize-none rounded-[20px] border border-border bg-surface px-4 py-2 text-base leading-6 placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="btn-press flex size-10 shrink-0 items-center justify-center rounded-full bg-nus-orange text-white transition-opacity disabled:opacity-30"
          >
            <ArrowUpIcon size={20} strokeWidth={2.6} />
          </button>
        </div>
        {draftLength > MAX_MESSAGE_LENGTH * 0.8 && (
          <p className={clsx("tabular mt-1 text-right text-xs", draftLength > MAX_MESSAGE_LENGTH ? "text-danger" : "text-muted")}>
            {draftLength.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </p>
        )}
      </form>
    </section>
  );
}
