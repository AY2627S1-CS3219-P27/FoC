import Link from "next/link";

export function CreditTransactionHistoryLink() {
  return (
    <section
      aria-labelledby="credit-transaction-history-link-heading"
      className="rounded-2xl border border-border bg-surface p-6 mb-6 shadow-sm"
    >
      <h3
        id="credit-transaction-history-link-heading"
        className="text-lg font-semibold"
      >
        Transaction History
      </h3>
      <p className="mt-1 text-sm text-muted">
        Review reservations, adjustments, transfers, and releases involving
        your credit account.
      </p>
      <Link
        href="/home/transactions"
        className="btn-press mt-4 inline-block rounded-xl bg-nus-blue px-4 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light transition-colors"
      >
        View transaction history
      </Link>
    </section>
  );
}
