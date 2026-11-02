import { clsx } from "clsx";
import { ChevronDownIcon } from "./icons";

// Filled fields with no border, like system text fields on a grouped cell.
export const inputClass =
  "h-11 rounded-xl border-0 bg-fill px-3.5 text-[15px] text-foreground transition-shadow duration-150 placeholder:text-muted disabled:opacity-60";

export const textareaClass =
  "rounded-xl border-0 bg-fill px-3.5 py-2.5 text-[15px] text-foreground transition-shadow duration-150 placeholder:text-muted";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={clsx("block min-w-0", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="fade-in text-[13px] break-words text-danger">
      {children}
    </p>
  );
}

// A filter shown as a pill with a chevron, wrapping the native select so phones keep their picker.
export function FilterSelect({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"select"> & { label: string }) {
  return (
    <span className={clsx("relative inline-flex shrink-0", className)}>
      <select
        aria-label={label}
        className="h-9 w-full min-w-0 appearance-none truncate rounded-full border-0 bg-surface pr-8 pl-3.5 text-[13px] font-medium text-foreground shadow-raised"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon size={13} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </span>
  );
}

// For a field sitting straight on the grouped gray, where the gray fill would vanish.
export const surfaceInputClass = inputClass.replace("bg-fill", "bg-surface");
