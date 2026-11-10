"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RollingCubes } from "@/components/cubes";
import { Avatar } from "@/components/ui/avatar";
import {
  ArchiveBoxIcon,
  BoxIcon,
  ChatIcon,
  FlagIcon,
  PeopleIcon,
  PersonIcon,
  QuestionIcon,
  SignOutIcon,
  StoreIcon,
  TrayIcon,
} from "@/components/ui/icons";
import { ADMIN_TABS, TAB_TITLES, type Tab, type UserProfile } from "../_shared/types";

// Sections that live on their own routes rather than behind /home?tab=.
export type RouteSection = "chats" | "archives" | "help";
export type Section = Tab | RouteSection;

const ROUTE_HREF: Record<RouteSection, string> = { chats: "/home/chats", archives: "/home/archives", help: "/home/help" };

const ICONS: Record<Section, typeof BoxIcon> = {
  errands: BoxIcon,
  chats: ChatIcon,
  archives: ArchiveBoxIcon,
  help: QuestionIcon,
  suppliers: StoreIcon,
  profile: PersonIcon,
  users: PeopleIcon,
  requests: TrayIcon,
  disputes: FlagIcon,
};

const TITLES: Record<Section, string> = { ...TAB_TITLES, chats: "Chats", archives: "Archives", help: "Help" };

const isRoute = (section: Section): section is RouteSection => section in ROUTE_HREF;

// Errands first, then the conversations about them; the rest follow the order of the tabs, with Help last.
function mainSections(tabs: Tab[]): Section[] {
  const rest = tabs.filter((t) => !ADMIN_TABS.includes(t));
  const [first, ...others] = rest;
  return first === undefined ? ["chats", "archives", "help"] : [first, "chats", "archives", ...others, "help"];
}

// Sidebar on wide screens, tab bar on phones; a translucent top bar shows the section name once its large title scrolls away.
export function AppShell({
  tabs,
  tab,
  onTab,
  user,
  signingOut,
  onSignOut,
  immersive = false,
  children,
}: {
  tabs: Tab[];
  tab: Section;
  onTab: (tab: Tab) => void;
  user: UserProfile;
  signingOut: boolean;
  onSignOut: () => void;
  /** A conversation fills the phone screen with its own header and composer, so the bars step aside. */
  immersive?: boolean;
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 44);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const mainTabs = mainSections(tabs);
  const adminTabs = tabs.filter((t) => ADMIN_TABS.includes(t));
  // The phone tab bar keeps Archives one tap inside Chats, so the items never crowd it.
  const barSections = [...mainTabs.filter((s) => s !== "archives"), ...adminTabs];

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
        className={clsx(
          "material-bar bar-edge sticky top-0 z-30 pt-[env(safe-area-inset-top)]",
          immersive && "max-md:hidden",
        )}
      >
        <div className="mx-auto grid h-12 max-w-4xl grid-cols-[1fr_auto_1fr] items-center px-4 md:px-8">
          <div className="md:hidden">
            <RollingCubes size={6} className="-ml-2 h-10 w-14" />
          </div>
          <p className="compact-title col-start-2 truncate text-[17px] font-semibold">{TITLES[tab]}</p>
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

      <main
        className={clsx(
          "mx-auto w-full max-w-4xl",
          immersive
            ? "md:px-8 md:py-4"
            : "px-4 pt-1 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:px-8 md:pt-2 md:pb-16",
        )}
      >
        {children}
      </main>

      <nav
        aria-label="Sections"
        className={clsx(
          "material-bar fixed inset-x-0 bottom-0 z-40 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden",
          immersive && "hidden",
        )}
      >
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${barSections.length}, minmax(0, 1fr))` }}>
          {barSections.map((t) => {
            const Icon = ICONS[t];
            // Archives sit under Chats on a phone, so Chats stays lit on both.
            const active = t === tab || (t === "chats" && tab === "archives");
            const className = clsx(
              "btn-press flex min-w-0 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors duration-150",
              active ? "text-nus-orange" : "text-muted",
            );
            const content = (
              <>
                <Icon size={24} strokeWidth={active ? 2.2 : 1.8} />
                <span className="max-w-full truncate">{TITLES[t]}</span>
              </>
            );
            return isRoute(t) ? (
              <Link key={t} href={ROUTE_HREF[t]} aria-current={active ? "page" : undefined} className={className}>
                {content}
              </Link>
            ) : (
              <button key={t} type="button" aria-current={active ? "page" : undefined} onClick={() => onTab(t)} className={className}>
                {content}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SidebarGroup({ tabs, tab, onTab }: { tabs: Section[]; tab: Section; onTab: (tab: Tab) => void }) {
  return (
    <ul className="space-y-0.5">
      {tabs.map((t) => {
        const Icon = ICONS[t];
        const active = t === tab;
        const className = clsx(
          "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] transition-colors duration-150",
          active ? "bg-fill font-semibold text-foreground" : "text-foreground/85 hover:bg-fill/60",
        );
        const content = (
          <>
            <Icon size={18} className="shrink-0 text-nus-orange" />
            {TITLES[t]}
          </>
        );
        return (
          <li key={t}>
            {isRoute(t) ? (
              <Link href={ROUTE_HREF[t]} aria-current={active ? "page" : undefined} className={className}>
                {content}
              </Link>
            ) : (
              <button type="button" aria-current={active ? "page" : undefined} onClick={() => onTab(t)} className={className}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
