"use client";

import { Tabs } from "@base-ui/react/tabs";
import { clsx } from "clsx";

const STYLES = {
  // On the blue header bar.
  nav: {
    list: "relative flex gap-1",
    tab: "relative z-10 h-9 rounded-lg px-3 text-sm font-medium text-white/70 transition-colors duration-150 hover:text-white data-active:text-white",
    indicator: "tab-indicator absolute inset-y-0 rounded-lg bg-white/18",
  },
  // Full-width strip under the header on phones.
  strip: {
    list: "relative flex w-full",
    tab: "relative z-10 h-11 flex-1 px-1 text-sm font-medium text-white/65 transition-colors duration-150 data-active:text-white",
    indicator: "tab-indicator absolute bottom-0 h-0.5 rounded-full bg-nus-orange",
  },
  // A segmented control on the page.
  pill: {
    list: "relative inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1",
    tab: "relative z-10 h-8 shrink-0 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-150 hover:text-foreground data-active:text-white",
    indicator: "tab-indicator absolute inset-y-1 rounded-lg bg-nus-orange shadow-card",
  },
};

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  variant = "pill",
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: readonly (readonly [T, string])[];
  variant?: keyof typeof STYLES;
  label: string;
  className?: string;
}) {
  const s = STYLES[variant];
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <Tabs.List aria-label={label} className={s.list}>
        {items.map(([v, text]) => (
          <Tabs.Tab key={v} value={v} className={clsx("btn-press", s.tab)}>
            {text}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className={s.indicator} />
      </Tabs.List>
    </Tabs.Root>
  );
}
