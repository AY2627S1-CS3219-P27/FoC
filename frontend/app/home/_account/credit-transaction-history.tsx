"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, List, ListRow, Pill, SkeletonList } from "@/components/ui/layout";
import { api } from "@/lib/api";

const PAGE_LIMIT = 25;

export type CreditTransactionType =
  | "RESERVATION"
  | "RESERVATION_ADJUSTMENT"
  | "TRANSFER"
  | "RELEASE";

export type CreditBalanceType = "CREDIT_BALANCE" | "RESERVED_BALANCE";

export interface CreditTransactionParticipant {
  userId: string;
  balanceType: CreditBalanceType;
}

export interface CreditTransaction {
  transactionId: string;
  type: CreditTransactionType;
  datetime: string;
  amount: number;
  errandId: string;
  origin: CreditTransactionParticipant;
  destination: CreditTransactionParticipant;
}

export interface CreditTransactionPage {
  items: CreditTransaction[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface TransactionPresentation {
  label: string;
  amountPrefix: "" | "+" | "−";
  amountClass: string;
}

export function getTransactionPresentation(
  transaction: CreditTransaction,
  userId: string,
): TransactionPresentation {
  switch (transaction.type) {
    case "RESERVATION":
      return {
        label: "Reserved credits",
        amountPrefix: "",
        amountClass: "text-foreground",
      };
    case "RESERVATION_ADJUSTMENT":
      return {
        label:
          transaction.destination.balanceType === "RESERVED_BALANCE"
            ? "Increased reservation"
            : "Reduced reservation",
        amountPrefix: "",
        amountClass: "text-foreground",
      };
    case "TRANSFER":
      if (transaction.destination.userId === userId) {
        return {
          label: "Received credits",
          amountPrefix: "+",
          amountClass: "text-success",
        };
      }
      return {
        label: "Sent credits",
        amountPrefix: "−",
        amountClass: "text-danger",
      };
    case "RELEASE":
      return {
        label: "Released credits",
        amountPrefix: "",
        amountClass: "text-foreground",
      };
  }
}

function balanceLabel(balanceType: CreditBalanceType): string {
  return balanceType === "CREDIT_BALANCE" ? "Available" : "Reserved";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

const TYPE_TONE: Record<CreditTransactionType, React.ComponentProps<typeof Pill>["tone"]> = {
  RESERVATION: "blue",
  RESERVATION_ADJUSTMENT: "orange",
  TRANSFER: "success",
  RELEASE: "neutral",
};

function typeLabel(type: CreditTransactionType): string {
  switch (type) {
    case "RESERVATION":
      return "Reservation";
    case "RESERVATION_ADJUSTMENT":
      return "Adjustment";
    case "TRANSFER":
      return "Transfer";
    case "RELEASE":
      return "Release";
  }
}

function TransactionRow({
  transaction,
  userId,
}: {
  transaction: CreditTransaction;
  userId: string;
}) {
  const presentation = getTransactionPresentation(transaction, userId);
  const counterparty =
    transaction.type === "TRANSFER"
      ? transaction.destination.userId === userId
        ? transaction.origin.userId
        : transaction.destination.userId
      : null;

  return (
    <ListRow
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">{presentation.label}</span>
          <Pill tone={TYPE_TONE[transaction.type]}>{typeLabel(transaction.type)}</Pill>
        </span>
      }
      subtitle={
        <>
          <span className="block">
            {balanceLabel(transaction.origin.balanceType)} →{" "}
            {balanceLabel(transaction.destination.balanceType)}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3">
            <span title={transaction.errandId} aria-label={`Errand ${transaction.errandId}`}>
              Errand <span className="font-mono">#{shortId(transaction.errandId)}</span>
            </span>
            {counterparty && (
              <span title={counterparty} aria-label={`Counterparty ${counterparty}`}>
                {transaction.destination.userId === userId ? "From" : "To"} user{" "}
                <span className="font-mono">{shortId(counterparty)}</span>
              </span>
            )}
          </span>
        </>
      }
      trailing={
        <span className="shrink-0 text-right">
          <span
            className={`tabular block text-[17px] font-semibold ${presentation.amountClass}`}
            aria-label={`${presentation.label}: ${presentation.amountPrefix}${transaction.amount.toLocaleString()} credits`}
          >
            {presentation.amountPrefix}
            {transaction.amount.toLocaleString()}
          </span>
          <time className="block text-[13px] text-muted" dateTime={transaction.datetime}>
            {new Date(transaction.datetime).toLocaleString()}
          </time>
        </span>
      }
    />
  );
}

type HistoryError = "not-found" | "error" | null;

export function CreditTransactionHistory({ userId }: { userId: string }) {
  const [page, setPage] = useState<CreditTransactionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<HistoryError>(null);
  const requestId = useRef(0);
  const retryOffset = useRef(0);

  const loadPage = useCallback(async (offset: number) => {
    const currentRequest = ++requestId.current;
    retryOffset.current = offset;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(PAGE_LIMIT),
    });
    const result = await api<CreditTransactionPage>(
      "GET",
      `/api/credits/transactions?${params}`,
    );

    if (currentRequest !== requestId.current) return;

    if (result.ok && result.data) {
      setPage(result.data);
      setError(null);
    } else if (result.status === 404 && result.code === "CREDIT_ACCOUNT_NOT_FOUND") {
      setPage(null);
      setError("not-found");
    } else {
      setError("error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(0), 0);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [loadPage, userId]);

  const retry = () => void loadPage(retryOffset.current);
  const showInitialLoading = loading && !page;
  const firstRecord = page && page.items.length > 0 ? page.offset + 1 : 0;
  const lastRecord = page ? page.offset + page.items.length : 0;

  if (showInitialLoading) return <SkeletonList count={6} />;

  if (error === "not-found") {
    return (
      <div className="rounded-2xl bg-surface">
        <EmptyState
          title="Account not ready"
          body="Your transaction history will appear after your credit account is ready."
        />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="rounded-2xl bg-surface">
        <EmptyState
          tone="error"
          title="History unavailable"
          body="Transaction history is temporarily unavailable."
          action={
            <Button intent="tinted" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <section aria-label="Credit transaction history" className="space-y-3">
      {error === "error" && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl bg-danger/10 px-4 py-3 text-[15px] text-danger"
        >
          <span>Could not load that page.</span>
          <Button intent="danger-outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {page.items.length === 0 ? (
        <div className="rounded-2xl bg-surface">
          <EmptyState title="No transactions yet" body="Credit movements will show up here." />
        </div>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <List>
            {page.items.map((transaction) => (
              <TransactionRow
                key={transaction.transactionId}
                transaction={transaction}
                userId={userId}
              />
            ))}
          </List>
        </div>
      )}

      {page.total > 0 && (
        <nav
          aria-label="Transaction history pagination"
          className="flex flex-col items-center gap-2 pt-2"
        >
          <p className="tabular text-[13px] text-muted" aria-live="polite">
            {loading ? "Updating…" : `Showing ${firstRecord}–${lastRecord} of ${page.total.toLocaleString()}`}
          </p>
          <div className="flex gap-2">
            <Button
              intent="outline"
              size="sm"
              onClick={() => void loadPage(Math.max(0, page.offset - page.limit))}
              disabled={loading || page.offset === 0}
            >
              Previous
            </Button>
            <Button
              intent="outline"
              size="sm"
              onClick={() => void loadPage(page.offset + page.limit)}
              disabled={loading || !page.hasMore}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
