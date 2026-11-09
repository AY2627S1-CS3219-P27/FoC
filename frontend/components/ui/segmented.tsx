"use client";

import { Tabs } from "@base-ui/react/tabs";
import { clsx } from "clsx";

// Segmented control: a gray track with a raised pill that glides to the selected segment.
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: readonly (readonly [T, string])[];
  label: string;
  className?: string;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={clsx("min-w-0 max-w-full", className)}>
      <Tabs.List aria-label={label} className="relative flex w-full rounded-[9px] bg-fill p-0.5 sm:inline-flex sm:w-auto">
        {items.map(([v, text]) => (
          <Tabs.Tab
            key={v}
            value={v}
            className="relative z-10 h-8 min-w-0 flex-auto truncate rounded-[7px] px-3 text-[13px] font-medium text-foreground/80 transition-colors duration-150 data-active:font-semibold data-active:text-foreground sm:flex-none sm:px-5"
          >
            {text}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="tab-indicator absolute inset-y-0.5 rounded-[7px] bg-surface shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:bg-[#636366]" />
      </Tabs.List>
    </Tabs.Root>
  );
}
