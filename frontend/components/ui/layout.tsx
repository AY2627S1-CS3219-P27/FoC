import { clsx } from "clsx";
import Link from "next/link";
import { Button } from "./button";
import { AlertIcon, ChevronRightIcon, InboxIcon } from "./icons";

// Large title, as at the top of a navigation stack; the shell shows a compact copy once it scrolls away.
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="large-title break-words">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A grouped section: optional caption above, white rounded body, optional footnote below.
export function Section({
  title,
  footer,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("min-w-0", className)} {...props}>
      {title && <h2 className="section-label mb-1.5 px-4">{title}</h2>}
      <div className={clsx("overflow-hidden rounded-2xl bg-surface", bodyClassName)}>{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] text-muted">{footer}</p>}
    </section>
  );
}

// Kept for content blocks that are not row lists.
export function Card({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={clsx("rounded-2xl bg-surface p-4 sm:p-5", className)} {...props}>
      {children}
    </section>
  );
}

// Rows separated by hairlines that start after the leading icon, like a table view.
export function List({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ul
      className={clsx(
        "overflow-hidden rounded-2xl bg-surface [&>li+li_.row-content]:border-t",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function ListRow({
  leading,
  title,
  subtitle,
  detail,
  trailing,
  onClick,
  href,
  chevron = !!onClick,
  tone = "default",
  className,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  tone?: "default" | "danger" | "tint";
  className?: string;
}) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center self-center">{leading}</span>}
      <span
        className={clsx(
          "row-content flex min-w-0 flex-1 items-center gap-3 border-border py-3 pr-4",
          leading ? "ml-3" : "ml-4",
        )}
      >
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              "block text-[15px] break-words",
              tone === "danger" ? "text-danger" : tone === "tint" ? "text-nus-orange" : "text-foreground",
            )}
          >
            {title}
          </span>
          {subtitle && <span className="mt-0.5 block text-[13px] break-words text-muted">{subtitle}</span>}
        </span>
        {detail && <span className="max-w-[45%] shrink-0 text-right text-[15px] text-muted">{detail}</span>}
        {trailing}
        {chevron && <ChevronRightIcon size={14} strokeWidth={2.5} className="shrink-0 text-muted/60" />}
      </span>
    </>
  );
  const rowClass = clsx("flex w-full items-stretch text-left", (onClick || href) && "row-press", leading && "pl-4", className);
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      ) : href ? (
        // In-app paths navigate client-side; anything else is a plain link.
        href.startsWith("/") && !href.startsWith("//") ? (
          <Link href={href} className={rowClass}>
            {body}
          </Link>
        ) : (
          <a href={href} className={rowClass}>
            {body}
          </a>
        )
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

// Rounded colored square holding a glyph, like the icons in system settings.
export function IconTile({ color, children, size = 30 }: { color: string; children: React.ReactNode; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[8px] text-white"
      style={{ width: size, height: size, background: color }}
    >
      {children}
    </span>
  );
}

export function SkeletonList({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={clsx("overflow-hidden rounded-2xl bg-surface", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="skeleton size-8 rounded-[8px]" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/5 rounded" />
            <div className="skeleton h-3 w-3/5 rounded" />
          </div>
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
      className="fade-in flex flex-col items-center px-6 py-14 text-center"
    >
      <Icon size={40} strokeWidth={1.5} className={tone === "error" ? "mb-3 text-danger" : "mb-3 text-muted/70"} />
      <p className="text-[17px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[15px] break-words text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
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
    <div className="mt-5 flex flex-col items-center gap-2">
      <p className="tabular text-[13px] text-muted">
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
        "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        {
          neutral: "bg-fill text-muted",
          orange: "bg-nus-orange/14 text-nus-orange",
          blue: "bg-nus-blue-ink/12 text-nus-blue-ink",
          success: "bg-success/14 text-success",
          danger: "bg-danger/12 text-danger",
        }[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
