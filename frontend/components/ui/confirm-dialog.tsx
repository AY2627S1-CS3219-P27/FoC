"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button, type ButtonVariants } from "./button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  intent = "primary",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  intent?: ButtonVariants["intent"];
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="dialog-backdrop fixed inset-0 z-50" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Popup className="dialog-popup w-full max-w-sm rounded-2xl border border-border bg-background p-6 outline-none">
            <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="mt-1.5 text-sm text-muted">{description}</AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Close render={<Button intent="outline" size="sm" disabled={pending} />}>
                Cancel
              </AlertDialog.Close>
              <Button intent={intent} size="sm" disabled={pending} onClick={onConfirm}>
                {pending ? "Working…" : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
