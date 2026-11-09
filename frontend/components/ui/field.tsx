import { clsx } from "clsx";
import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "./icons";

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

export interface FilterOption {
  value: string;
  label: string;
}

// A filter shown as a pill with a chevron; opens the same rounded popup as OptionCombobox.
export function FilterSelect({
  label,
  className,
  options,
  value,
  onValueChange,
}: {
  label: string;
  className?: string;
  options: readonly FilterOption[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <BaseSelect.Root
      items={options as FilterOption[]}
      value={value}
      onValueChange={(next) => onValueChange(next ?? "")}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={clsx(
          "relative inline-flex h-9 min-w-0 shrink-0 cursor-pointer items-center rounded-full border-0 bg-surface pr-8 pl-3.5 text-left text-[13px] font-medium text-foreground shadow-raised outline-none",
          className,
        )}
      >
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted">
          <ChevronDownIcon size={13} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} collisionPadding={8} alignItemWithTrigger={false} className="z-[60]">
          <BaseSelect.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1.5 shadow-overlay outline-none">
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[15px] text-foreground outline-none data-highlighted:bg-fill"
              >
                <BaseSelect.ItemText className="truncate">{o.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="shrink-0 text-nus-orange">
                  <CheckIcon size={16} strokeWidth={2.5} />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

// For a field sitting straight on the grouped gray, where the gray fill would vanish.
export const surfaceInputClass = inputClass.replace("bg-fill", "bg-surface");
