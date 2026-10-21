import type { ErrandStatus } from "./types";

const STATUS_STYLES: Record<ErrandStatus, string> = {
  Pending: "bg-muted/15 text-muted",
  Open: "bg-nus-orange/15 text-nus-orange",
  Accepted: "bg-nus-blue/15 text-nus-blue",
  "Picked Up": "bg-nus-blue/15 text-nus-blue",
  Delivered: "bg-nus-blue/15 text-nus-blue",
  Completed: "bg-success/15 text-success",
  Cancelled: "bg-danger/15 text-danger",
  Incomplete: "bg-danger/15 text-danger",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status as ErrandStatus] ?? "bg-muted/15 text-muted";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${style}`}>
      {status}
    </span>
  );
}

export function timeLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export const inputClass =
  "rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-shadow";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
    </label>
  );
}
