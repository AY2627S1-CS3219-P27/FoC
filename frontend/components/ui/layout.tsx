import { clsx } from "clsx";
import { Button } from "./button";
import { AlertIcon, InboxIcon } from "./icons";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={clsx("rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6", className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function SkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={clsx("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-surface p-4">
          <div className="skeleton h-4 w-2/3 rounded-md" />
          <div className="skeleton mt-3 h-3 w-1/2 rounded-md" />
          <div className="skeleton mt-5 h-3 w-1/3 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  tone = "neutral",
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  const Icon = tone === "error" ? AlertIcon : InboxIcon;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className="fade-in flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center"
    >
      <span
        className={clsx(
          "mb-3 flex size-11 items-center justify-center rounded-full",
          tone === "error" ? "bg-danger/10 text-danger" : "bg-surface text-muted",
        )}
      >
        <Icon size={20} />
      </span>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm break-words text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  onLoadMore,
  noun,
}: {
  shown: number;
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  noun: string;
}) {
  if (!hasMore && (total === null || total <= shown)) return null;
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <p className="text-sm text-muted tabular">
        Showing {shown.toLocaleString()}
        {total !== null && ` of ${total.toLocaleString()}`} {noun}
      </p>
      {hasMore && (
        <Button intent="outline" size="sm" disabled={loading} onClick={onLoadMore}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "orange" | "blue" | "success" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium",
        {
          neutral: "bg-muted/12 text-muted",
          orange: "bg-nus-orange/12 text-nus-orange",
          blue: "bg-nus-blue-ink/12 text-nus-blue-ink",
          success: "bg-success/12 text-success",
          danger: "bg-danger/12 text-danger",
        }[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
