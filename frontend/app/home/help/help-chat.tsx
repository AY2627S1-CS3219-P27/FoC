"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { MAX_QUESTION_LENGTH, useHelpChat, type HelpExchange, type HelpSource } from "@/lib/assistant/use-help-chat";

const BOTTOM_THRESHOLD_PX = 48;
const COMPOSER_MAX_HEIGHT_PX = 132;
const COUNTER_FROM = MAX_QUESTION_LENGTH * 0.8;

// Written from docs/support/help-bot.md; keep the two in step.
const INTRODUCTION = [
  "👋 Hi! I'm the FoC help bot. Ask me how FoC works, like how credits work 💰, what an errand status means 📦, or what to do when something goes wrong 🛠️. I answer only from FoC's help documents 📚 and show where each answer came from.",
  "🙈 I can't see your account or do anything for you, so for your balance or a particular errand, open that page in the app. 💡 Each question stands alone, so include the details.",
  "🔒 Your questions are kept for 30 days and sent to an outside AI provider, so please don't include passwords or other sensitive details.",
];

// The model sometimes marks words as **bold** or `code`. Building elements keeps everything else as plain text, so an answer can never inject HTML.
function renderAnswer(answer: string): React.ReactNode[] {
  // Two capture groups, so split returns text, bold, code, text, bold, code...
  return answer.split(/\*\*([^*\n]+)\*\*|`([^`\n]+)`/g).map((part, index) => {
    if (part === undefined) return null;
    if (index % 3 === 1) return <strong key={index} className="font-semibold">{part}</strong>;
    if (index % 3 === 2) return <code key={index} className="font-mono text-[0.9em]">{part}</code>;
    return part;
  });
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <article className="bubble-in max-w-[80%] origin-bottom-left rounded-[20px] rounded-bl-md bg-surface px-3.5 py-2 sm:max-w-[70%] md:bg-fill">
      {children}
    </article>
  );
}

function Sources({ sources }: { sources: HelpSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 max-w-[80%] px-1 text-xs text-muted sm:max-w-[70%]">
      📚 {sources.length === 1 ? "Source" : "Sources"}: {sources.map((s) => `${s.title} · ${s.section}`).join("; ")}
    </p>
  );
}

function Exchange({ exchange, canRetry, onRetry }: { exchange: HelpExchange; canRetry: boolean; onRetry: () => void }) {
  const failed = exchange.status === "failed";
  return (
    <li className="mt-3 flex flex-col">
      <div className="flex flex-col items-end">
        <article
          className={clsx(
            "bubble-in max-w-[80%] origin-bottom-right rounded-[20px] rounded-br-md px-3.5 py-2 sm:max-w-[70%]",
            failed ? "bg-danger/12" : "bg-nus-blue text-white",
          )}
        >
          <p className={clsx("whitespace-pre-wrap break-words text-[15px]", failed && "text-foreground")}>{exchange.question}</p>
        </article>
        {failed && (
          <p className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 px-1 text-[11px] font-medium text-muted">
            <span className="text-danger">⚠️ Couldn&apos;t get an answer. {exchange.error}</span>
            <button type="button" disabled={!canRetry} onClick={onRetry} className="font-semibold text-nus-orange disabled:opacity-40">
              Retry
            </button>
          </p>
        )}
      </div>
      {exchange.status === "waiting" && (
        <div className="mt-3 flex flex-col items-start">
          <BotBubble>
            <p className="text-[15px] text-muted">🔍 Looking through the help documents…</p>
          </BotBubble>
        </div>
      )}
      {exchange.status === "answered" && (
        <div className="mt-3 flex flex-col items-start">
          <BotBubble>
            <p className="whitespace-pre-wrap break-words text-[15px]">{renderAnswer(exchange.answer)}</p>
          </BotBubble>
          <Sources sources={exchange.sources} />
        </div>
      )}
    </li>
  );
}

export function HelpChat() {
  const { exchanges, waiting, ask, retry } = useHelpChat();
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const isAtBottomRef = useRef(true);
  const forceScrollRef = useRef(false);

  useEffect(() => {
    if (!forceScrollRef.current && !isAtBottomRef.current) return;
    forceScrollRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (!transcript) return;
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
      isAtBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exchanges]);

  // The backend trims before it counts, so count the same way.
  const question = draft.trim();
  const questionLength = [...question].length;
  const canSend = !waiting && questionLength > 0 && questionLength <= MAX_QUESTION_LENGTH;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    forceScrollRef.current = true;
    ask(question);
    setDraft("");
    if (composerRef.current) composerRef.current.style.height = "auto";
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

  function resizeComposer(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    // scrollHeight excludes the border, but the box is border-sizing, so add it back or a 2px overflow draws a scrollbar.
    const border = element.offsetHeight - element.clientHeight;
    const wanted = element.scrollHeight + border;
    element.style.height = `${Math.min(wanted, COMPOSER_MAX_HEIGHT_PX)}px`;
    element.style.overflowY = wanted > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  return (
    <section
      aria-labelledby="help-heading"
      className="fade-in mx-auto flex h-dvh min-h-0 max-w-3xl flex-col overflow-hidden bg-background md:h-[calc(100dvh-5rem)] md:rounded-2xl md:bg-surface"
    >
      <header className="material-bar bar-edge shrink-0 border-b border-border pt-[env(safe-area-inset-top)]" data-scrolled>
        <div className="flex items-center gap-2 px-2 py-2 md:px-3">
          <Link href="/home" aria-label="Home" className="btn-press flex h-10 shrink-0 items-center rounded-full pr-1 pl-1 text-nus-orange md:hidden">
            <ChevronLeftIcon size={24} strokeWidth={2.4} />
          </Link>
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nus-orange/12 text-[20px]">
            🤖
          </span>
          <div className="min-w-0 flex-1">
            <h1 id="help-heading" className="truncate text-[16px] leading-tight font-semibold">FoC help bot</h1>
            <p className="truncate text-xs text-muted">✨ Answers from FoC&apos;s help documents</p>
          </div>
        </div>
      </header>

      <div ref={transcriptRef} onScroll={trackTranscriptPosition} className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-3 py-4 md:px-5" aria-live="polite">
        <ol className="flex flex-col" aria-label="Messages">
          <li className="flex flex-col items-start">
            <BotBubble>
              <div className="space-y-2 text-[15px]">
                {INTRODUCTION.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </BotBubble>
          </li>
          {exchanges.map((exchange) => (
            <Exchange key={exchange.id} exchange={exchange} canRetry={!waiting} onRetry={() => retry(exchange)} />
          ))}
        </ol>
      </div>

      <form onSubmit={submit} className="material-bar shrink-0 border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:px-4">
        <label htmlFor="help-question" className="sr-only">Your question</label>
        <div className="flex items-end gap-2">
          <textarea
            id="help-question"
            ref={composerRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              resizeComposer(event.target);
            }}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            maxLength={MAX_QUESTION_LENGTH * 2}
            placeholder="💬 Ask a question about FoC"
            className="max-h-[132px] min-h-10 flex-1 resize-none rounded-[20px] border border-border bg-surface px-4 py-2 text-base leading-6 placeholder:text-muted"
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
        {questionLength >= COUNTER_FROM && (
          <p className={clsx("tabular mt-1 text-right text-xs", questionLength > MAX_QUESTION_LENGTH ? "text-danger" : "text-muted")}>
            {questionLength} / {MAX_QUESTION_LENGTH}
          </p>
        )}
      </form>
    </section>
  );
}
