"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";

// System toggle: the thumb slides and the track fills with the tint.
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full bg-[rgba(120,120,128,0.16)] p-[2px] transition-colors duration-200 ease-out data-checked:bg-nus-orange data-disabled:opacity-40 dark:bg-[rgba(120,120,128,0.32)]"
    >
      <BaseSwitch.Thumb className="size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-transform duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] data-checked:translate-x-5" />
    </BaseSwitch.Root>
  );
}
