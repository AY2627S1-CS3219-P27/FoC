import { clsx } from "clsx";

export const inputClass =
  "h-10 rounded-xl border border-border bg-background px-3.5 text-sm transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 disabled:opacity-60";

export const textareaClass =
  "rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70";

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
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="fade-in text-sm break-words text-danger">
      {children}
    </p>
  );
}
