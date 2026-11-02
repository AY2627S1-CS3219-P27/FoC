import { Pill } from "@/components/ui/layout";
import type { ErrandStatus } from "./types";

export { Field, inputClass } from "@/components/ui/field";

const STATUS_TONES: Record<ErrandStatus, React.ComponentProps<typeof Pill>["tone"]> = {
  Pending: "neutral",
  Open: "orange",
  Accepted: "blue",
  "Picked Up": "blue",
  Delivered: "blue",
  Completed: "success",
  Cancelled: "danger",
  Incomplete: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONES[status as ErrandStatus] ?? "neutral"} className="shrink-0 whitespace-nowrap">
      {status}
    </Pill>
  );
}

export function timeLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "expired";
  if (ms < 60_000) return "under 1 min left";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m left`;
  return `${Math.floor(hours / 24)}d left`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function formatCredits(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "credit" : "credits"}`;
}
