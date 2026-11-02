"use client";

import { Drawer } from "@base-ui/react/drawer";
import { clsx } from "clsx";
import { useState } from "react";
import { CloseIcon } from "./icons";

// Mounted by the parent while it has something to show; closing plays the exit before onClose unmounts it.
export function Sheet({
  title,
  description,
  onClose,
  wide = false,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => !isOpen && onClose()}
      swipeDirection="right"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="sheet-backdrop fixed inset-0 z-50" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex justify-end">
          <Drawer.Popup
            className={clsx(
              "sheet-popup flex h-full w-full flex-col border-l border-border bg-background outline-none",
              wide ? "max-w-3xl" : "max-w-md",
            )}
          >
            <header
              data-scrolled={scrolled || undefined}
              className="sheet-header flex items-start justify-between gap-4 px-6 pt-5 pb-4"
            >
              <div className="min-w-0">
                <Drawer.Title className="text-lg font-semibold break-words">{title}</Drawer.Title>
                {description && (
                  <Drawer.Description className="mt-0.5 text-sm text-muted break-words">
                    {description}
                  </Drawer.Description>
                )}
              </div>
              <Drawer.Close
                aria-label="Close"
                className="btn-press -mr-1.5 flex size-9 shrink-0 pointer-coarse:size-11 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-foreground"
              >
                <CloseIcon />
              </Drawer.Close>
            </header>
            <Drawer.Content
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
              className="flex-1 overflow-y-auto overscroll-contain px-6 pt-1 pb-6"
            >
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
