"use client";

import { clsx } from "clsx";
import { useEffect } from "react";
import { arriveAt } from "@/lib/nav-pulse";
import { RollingCubes } from "./cubes";

// Order of the sign-in pages, so moving between them rolls the cubes the right way.
export const AUTH_PLACE = { login: 0, register: 1, forgot: 1, reset: 2 } as const;

export function AuthShell({
  place,
  title,
  subtitle,
  children,
}: {
  place: number;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => arriveAt(place), [place]);

  return (
    <main className="flex flex-1 items-start justify-center px-4 pt-[12vh] pb-10 sm:items-center sm:pt-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <RollingCubes size={18} className="mb-3 h-24 w-44" />
          <h1 className="large-title">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] break-words text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function AuthCard({ className, children, ...props }: React.ComponentProps<"form">) {
  return (
    <form method="post" className={clsx("flex flex-col gap-4", className)} {...props}>
      {children}
    </form>
  );
}

// Stacked fields in one rounded group with hairlines between them, as on a system sign-in sheet.
export function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-raised [&>*+*]:border-t [&>*+*]:border-border">
      {children}
    </div>
  );
}

export const groupInputClass =
  "block h-12 w-full border-0 bg-transparent px-4 text-[17px] text-foreground placeholder:text-muted focus-visible:shadow-none focus-visible:bg-fill/40";

export function AuthLinks({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center gap-5 text-[15px]">{children}</div>;
}

export const authLinkClass = "text-nus-orange hover:opacity-70";
