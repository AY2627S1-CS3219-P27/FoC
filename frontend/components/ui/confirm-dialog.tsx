"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { clsx } from "clsx";
import type { ButtonVariants } from "./button";

// System-style alert: centred text, full-width buttons split by hairlines; Cancel is bold, a destructive action is red.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  intent = "primary",
  pending = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  intent?: ButtonVariants["intent"];
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  // Optional field shown under the description, e.g. a reason or an amount.
  children?: React.ReactNode;
}) {
  const destructive = intent === "danger" || intent === "danger-outline";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop forceRender className="dialog-backdrop fixed inset-0 z-[70]" />
        <AlertDialog.Viewport className="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <AlertDialog.Popup className="dialog-popup material-sidebar w-full max-w-[300px] overflow-hidden rounded-[18px] text-center text-foreground shadow-overlay outline-none">
            <div className="px-5 pt-5 pb-4">
              <AlertDialog.Title className="text-[17px] font-semibold">{title}</AlertDialog.Title>
              <AlertDialog.Description className="mt-1 text-[13px] text-foreground/80">{description}</AlertDialog.Description>
              {children && <div className="mt-3 text-left">{children}</div>}
            </div>
            <div className="grid grid-cols-2 border-t border-border">
              <AlertDialog.Close
                disabled={pending}
                className="row-press h-11 border-r border-border text-[17px] font-semibold text-nus-orange disabled:opacity-40"
              >
                Cancel
              </AlertDialog.Close>
              <button
                type="button"
                disabled={pending || confirmDisabled}
                onClick={onConfirm}
                className={clsx(
                  "row-press h-11 truncate px-2 text-[17px] disabled:opacity-40",
                  destructive ? "text-danger" : "text-nus-orange",
                )}
              >
                {pending ? "Working…" : confirmLabel}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
