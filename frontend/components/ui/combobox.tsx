"use client";

import * as React from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { clsx } from "clsx";
import { inputClass } from "./field";
import { CheckIcon, ChevronDownIcon, CloseIcon } from "./icons";

export interface ComboboxOption<V extends string> {
  value: V;
  /** What the collapsed input shows once this option is selected. */
  label: string;
  /** Row heading in the dropdown; falls back to `label`. Keep it short. */
  title?: string;
  /** Secondary line in the list, e.g. the building's full name. */
  detail?: string;
  /** Extra text the query should match, e.g. the building's short code. */
  keywords?: readonly string[];
}

// Case-insensitive "contains" across everything the user might know: the row
// heading, the input label, the secondary line, and the keywords. Home Office
// long-list pattern: match anywhere in the option, not just the prefix.
function matches(option: ComboboxOption<string>, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") return true;
  const haystack = [
    option.title ?? option.label,
    option.label,
    option.detail ?? "",
    ...(option.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * A select with search, for option lists too long to scroll (WAI-ARIA APG
 * combobox with list autocomplete, via Base UI): typing filters the list,
 * Enter picks the highlighted row, and the value is always a real option —
 * text that matches nothing reverts on close.
 *
 * Not a replacement for native selects: short lists (<15 options) and list
 * filters keep the native control so phones keep their picker (see
 * FilterSelect).
 */
export function OptionCombobox<V extends string>({
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
}: {
  options: readonly ComboboxOption<V>[];
  /** "" when nothing is chosen yet. */
  value: V | "";
  onValueChange: (value: V | "") => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const hasValue = value !== "";
  const queryCount = query.trim() === "" ? null : options.filter((o) => matches(o, query)).length;

  return (
    // Item is named explicitly: with plain-array items Base UI defaults it to
    // the value type, which would mistype the filter callback.
    <BaseCombobox.Root<V, false, ComboboxOption<V>>
      items={options}
      value={value === "" ? null : (value as V)}
      onValueChange={(next) => onValueChange(next ?? "")}
      filter={(option, query) => matches(option, query)}
      // With plain-array items and a string value, Base UI has no way to map
      // the selected value back to its label and would print the raw value
      // (the entity id) into the input.
      itemToStringLabel={(v) => options.find((o) => o.value === v)?.label ?? ""}
      autoHighlight
      disabled={disabled}
      onInputValueChange={(inputValue) => setQuery(inputValue)}
    >
      <span className={clsx("relative block", className)}>
        <BaseCombobox.Input
          className={clsx(inputClass, "w-full pr-10 placeholder:text-muted")}
          placeholder={placeholder}
          autoComplete="off"
        />
        {hasValue && (
          <BaseCombobox.Clear
            aria-label="Clear selection"
            className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted hover:text-foreground"
          >
            <CloseIcon size={15} />
          </BaseCombobox.Clear>
        )}
        {!hasValue && (
          <ChevronDownIcon
            size={15}
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted"
          />
        )}
      </span>

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} collisionPadding={8} className="z-[60]">
          <BaseCombobox.Popup className="w-(--anchor-width) overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1.5 shadow-overlay outline-none">
            {queryCount !== null && (
              <BaseCombobox.Status className="px-2.5 py-1.5 text-xs text-muted">
                {queryCount === 0 ? "" : `${queryCount} ${queryCount === 1 ? "match" : "matches"}`}
              </BaseCombobox.Status>
            )}
            <BaseCombobox.List>
              {(option: ComboboxOption<V>, index: number) => (
                <BaseCombobox.Item
                  key={option.value}
                  value={option.value}
                  index={index}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[15px] text-foreground outline-none data-highlighted:bg-fill"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.title ?? option.label}</span>
                    {option.detail && (
                      <span className="block truncate text-xs text-muted">{option.detail}</span>
                    )}
                  </span>
                  <BaseCombobox.ItemIndicator className="shrink-0 text-nus-orange">
                    <CheckIcon size={16} strokeWidth={2.5} />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
            <BaseCombobox.Empty>
              <p className="px-2.5 py-2 text-[13px] text-muted">
                No matches for “{query.trim()}”.
              </p>
            </BaseCombobox.Empty>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
