"use client";

import { Drawer } from "@base-ui/react/drawer";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { pulseNavigation } from "@/lib/nav-pulse";
import { ChevronLeftIcon } from "./icons";

// A sheet rises from the bottom edge: full width on phones, a centred form sheet on wider screens. Swipe down or Done to close.
// Mounted by the parent while it has something to show; closing plays the exit before onClose unmounts it.
export function Sheet({
  title,
  description,
  onClose,
  onBack,
  backLabel = "Back",
  wide = false,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  wide?: boolean;
  // A function receives `close`, so content can dismiss the sheet with its exit animation (e.g. after saving).
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const announced = useRef(false);

  function close() {
    pulseNavigation("back");
    setOpen(false);
  }

  useEffect(() => {
    // Opening a sheet moves the user forward; the cubes say so once.
    if (!announced.current) {
      announced.current = true;
      pulseNavigation("forward");
    }
  }, []);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) pulseNavigation("back");
        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => !isOpen && onClose()}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="sheet-backdrop fixed inset-0 z-50" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-8">
          <Drawer.Popup
            className={clsx(
              "sheet-popup flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[22px] text-foreground outline-none md:max-h-[86dvh] md:rounded-[22px]",
              wide ? "md:max-w-2xl" : "md:max-w-lg",
            )}
          >
            <div aria-hidden="true" className="mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full bg-muted/40 md:hidden" />
            <header
              data-scrolled={scrolled || undefined}
              className="bar-edge grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 pt-2 pb-2.5 md:pt-3"
            >
              <div className="min-w-0">
                {onBack && (
                  <button
                    type="button"
                    onClick={() => {
                      pulseNavigation("back");
                      onBack();
                    }}
                    className="btn-press -ml-1 flex h-9 max-w-full items-center gap-0.5 rounded-full px-1.5 text-[15px] text-nus-orange"
                  >
                    <ChevronLeftIcon size={18} strokeWidth={2.5} className="shrink-0" />
                    <span className="truncate">{backLabel}</span>
                  </button>
                )}
              </div>
              <div className="min-w-0 max-w-[60vw] text-center md:max-w-xs">
                <Drawer.Title className="truncate text-[17px] font-semibold">{title}</Drawer.Title>
                {description && (
                  <Drawer.Description className="truncate text-xs text-muted">{description}</Drawer.Description>
                )}
              </div>
              <div className="flex justify-end">
                <Drawer.Close className="btn-press h-9 rounded-full px-2.5 text-[15px] font-semibold text-nus-orange">
                  Done
                </Drawer.Close>
              </div>
            </header>
            <Drawer.Content
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
              className="flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-5"
            >
              {typeof children === "function" ? children(close) : children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
