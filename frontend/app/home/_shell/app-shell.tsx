"use client";

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { RollingCubes } from "@/components/cubes";
import { Avatar } from "@/components/ui/avatar";
import { BoxIcon, PeopleIcon, PersonIcon, SignOutIcon, StoreIcon, TrayIcon } from "@/components/ui/icons";
import { TAB_TITLES, type Tab, type UserProfile } from "../_shared/types";

const ICONS: Record<Tab, typeof BoxIcon> = {
  errands: BoxIcon,
  suppliers: StoreIcon,
  profile: PersonIcon,
  users: PeopleIcon,
  requests: TrayIcon,
};

// Sidebar on wide screens, tab bar on phones; a translucent top bar shows the section name once its large title scrolls away.
export function AppShell({
  tabs,
  tab,
  onTab,
  user,
  signingOut,
  onSignOut,
  children,
}: {
  tabs: Tab[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  user: UserProfile;
  signingOut: boolean;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 44);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const mainTabs = tabs.filter((t) => t !== "users" && t !== "requests");
  const adminTabs = tabs.filter((t) => t === "users" || t === "requests");

  return (
    <div className="min-h-dvh md:pl-[264px]">
      <aside className="material-sidebar fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-border md:flex">
        <div className="flex items-center gap-1 px-3 pt-4 pb-3">
          <RollingCubes size={8} className="h-12 w-[72px] shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] leading-tight font-semibold">Friend on Campus</p>
            <p className="text-xs text-muted">NUS errands</p>
          </div>
        </div>

        <nav aria-label="Sections" className="flex-1 overflow-y-auto px-3 pb-3">
          <SidebarGroup tabs={mainTabs} tab={tab} onTab={onTab} />
          {adminTabs.length > 0 && (
            <>
              <p className="mt-5 mb-1 px-2.5 text-xs font-semibold text-muted">Admin</p>
              <SidebarGroup tabs={adminTabs} tab={tab} onTab={onTab} />
            </>
          )}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <Avatar url={user.profilePictureUrl} name={user.displayName} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold" title={user.displayName}>
              {user.displayName}
            </p>
            <p className="truncate text-xs text-muted" title={user.email}>
              {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="btn-press flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-foreground disabled:opacity-40"
          >
            <SignOutIcon size={17} />
          </button>
        </div>
      </aside>

      <header
        data-scrolled={scrolled || undefined}
        className="material-bar bar-edge sticky top-0 z-30 pt-[env(safe-area-inset-top)]"
      >
        <div className="mx-auto grid h-12 max-w-4xl grid-cols-[1fr_auto_1fr] items-center px-4 md:px-8">
          <div className="md:hidden">
            <RollingCubes size={6} className="-ml-2 h-10 w-14" />
          </div>
          <p className="compact-title col-start-2 truncate text-[17px] font-semibold">{TAB_TITLES[tab]}</p>
          <div className="col-start-3 flex justify-end md:hidden">
            <button
              type="button"
              onClick={() => onTab("profile")}
              aria-label="Account"
              className="btn-press rounded-full"
            >
              <Avatar url={user.profilePictureUrl} name={user.displayName} size={30} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pt-1 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:px-8 md:pt-2 md:pb-16">
        {children}
      </main>

      <nav
        aria-label="Sections"
        className="material-bar fixed inset-x-0 bottom-0 z-40 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => {
            const Icon = ICONS[t];
            const active = t === tab;
            return (
              <button
                key={t}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onTab(t)}
                className={clsx(
                  "flex min-w-0 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors duration-150",
                  active ? "text-nus-orange" : "text-muted",
                )}
              >
                <Icon size={24} strokeWidth={active ? 2.2 : 1.8} />
                <span className="max-w-full truncate">{TAB_TITLES[t]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SidebarGroup({ tabs, tab, onTab }: { tabs: Tab[]; tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <ul className="space-y-0.5">
      {tabs.map((t) => {
        const Icon = ICONS[t];
        const active = t === tab;
        return (
          <li key={t}>
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onTab(t)}
              className={clsx(
                "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] transition-colors duration-150",
                active ? "bg-fill font-semibold text-foreground" : "text-foreground/85 hover:bg-fill/60",
              )}
            >
              <Icon size={18} className="shrink-0 text-nus-orange" />
              {TAB_TITLES[t]}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
