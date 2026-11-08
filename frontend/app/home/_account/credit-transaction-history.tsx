"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-nus-blue/10 px-2 py-0.5 text-xs font-medium text-nus-blue dark:text-blue-300">
              {typeLabel(transaction.type)}
            </span>
            <span className="font-semibold">{presentation.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {balanceLabel(transaction.origin.balanceType)} →{" "}
            {balanceLabel(transaction.destination.balanceType)}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span title={transaction.errandId} aria-label={`Errand ${transaction.errandId}`}>
              Errand <span className="font-mono">#{shortId(transaction.errandId)}</span>
            </span>
            {counterparty && (
              <span title={counterparty} aria-label={`Counterparty ${counterparty}`}>
                {transaction.destination.userId === userId ? "From" : "To"} user{" "}
                <span className="font-mono">{shortId(counterparty)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <p
            className={`text-lg font-bold tabular-nums ${presentation.amountClass}`}
            aria-label={`${presentation.label}: ${presentation.amountPrefix}${transaction.amount.toLocaleString()} credits`}
          >
            {presentation.amountPrefix}
            {transaction.amount.toLocaleString()} credits
          </p>
          <time className="text-xs text-muted" dateTime={transaction.datetime}>
            {new Date(transaction.datetime).toLocaleString()}
          </time>
        </div>
      </div>
    </li>
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

  const showInitialLoading = loading && !page;
  const firstRecord = page && page.items.length > 0 ? page.offset + 1 : 0;
  const lastRecord = page ? page.offset + page.items.length : 0;

  return (
    <section
      aria-labelledby="credit-transaction-history-heading"
      className="rounded-2xl border border-border bg-surface mb-6 shadow-sm overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-5">
        <div>
          <h3 id="credit-transaction-history-heading" className="text-lg font-semibold">
            Transaction History
          </h3>
          <p className="mt-1 text-sm text-muted">Movements into, out of, and within your credit account.</p>
        </div>
        {loading && page && (
          <span role="status" className="text-sm text-muted">
            Updating…
          </span>
        )}
      </div>

      {showInitialLoading && (
        <p role="status" className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          Loading transaction history…
        </p>
      )}

      {!showInitialLoading && error === "not-found" && (
        <p role="alert" className="border-t border-border px-6 py-8 text-center text-sm text-muted">
          Your transaction history will appear after your credit account is ready.
        </p>
      )}

      {!showInitialLoading && error === "error" && !page && (
        <HistoryFailure onRetry={() => void loadPage(retryOffset.current)} />
      )}

      {page && (
        <>
          {error === "error" && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3 text-sm text-danger">
              <span>Could not load that page.</span>
              <button
                type="button"
                onClick={() => void loadPage(retryOffset.current)}
                className="btn-press rounded-xl border border-border px-3 py-1.5 font-medium hover:bg-background transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {page.items.length === 0 ? (
            <p className="border-t border-border px-6 py-8 text-center text-sm text-muted">
              No credit transactions yet.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border" aria-label="Credit transactions">
              {page.items.map((transaction) => (
                <TransactionRow
                  key={transaction.transactionId}
                  transaction={transaction}
                  userId={userId}
                />
              ))}
            </ul>
          )}

          {page.total > 0 && (
            <nav
              aria-label="Transaction history pagination"
              className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-muted" aria-live="polite">
                Showing {firstRecord}–{lastRecord} of {page.total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadPage(Math.max(0, page.offset - page.limit))}
                  disabled={loading || page.offset === 0}
                  className="btn-press rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => void loadPage(page.offset + page.limit)}
                  disabled={loading || !page.hasMore}
                  className="btn-press rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function HistoryFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 border-t border-border px-6 py-8 text-center">
      <p className="text-sm text-muted">Transaction history is temporarily unavailable.</p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-press rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-background transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
