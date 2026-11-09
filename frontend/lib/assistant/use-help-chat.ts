"use client";

import { useCallback, useRef, useState } from "react";
import { api, errorText } from "@/lib/api";

export const MAX_QUESTION_LENGTH = 500;

export interface HelpSource {
  title: string;
  section: string;
}

interface AssistantAnswer {
  answer: string;
  answered: boolean;
  sources: HelpSource[];
}

export type HelpExchange = { id: number; question: string } & (
  | { status: "waiting" }
  | { status: "failed"; error: string }
  | { status: "answered"; answer: string; sources: HelpSource[] }
);

// Each question stands alone on the backend, so the transcript only needs to live as long as the page.
export function useHelpChat() {
  const [exchanges, setExchanges] = useState<HelpExchange[]>([]);
  const nextId = useRef(1);
  // A ref, because two sends in the same render would both still see the old state.
  const inFlight = useRef(false);

  const fetchAnswer = useCallback(async (id: number, question: string) => {
    inFlight.current = true;
    const res = await api<AssistantAnswer>("POST", "/api/assistant/questions", { body: { question } });
    inFlight.current = false;
    const settled: HelpExchange =
      res.ok && res.data
        ? { id, question, status: "answered", answer: res.data.answer, sources: res.data.sources }
        : { id, question, status: "failed", error: errorText(res, "We couldn't get an answer. Try again.") };
    setExchanges((current) => current.map((exchange) => (exchange.id === id ? settled : exchange)));
  }, []);

  const ask = useCallback(
    (question: string) => {
      if (inFlight.current) return;
      const id = nextId.current++;
      setExchanges((current) => [...current, { id, question, status: "waiting" }]);
      void fetchAnswer(id, question);
    },
    [fetchAnswer],
  );

  const retry = useCallback(
    ({ id, question }: HelpExchange) => {
      if (inFlight.current) return;
      setExchanges((current) =>
        current.map((exchange) => (exchange.id === id ? { id, question, status: "waiting" } : exchange)),
      );
      void fetchAnswer(id, question);
    },
    [fetchAnswer],
  );

  return { exchanges, waiting: exchanges.some((e) => e.status === "waiting"), ask, retry };
}
