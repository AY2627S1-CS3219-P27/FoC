"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { authFetch, setSessionExpiredHandler } from "@/lib/api";
import { PushRegistrationSync } from "../_notifications/push-registration";
import { Avatar } from "./avatar";
import { parseCurrentUser, type UserProfile } from "./current-user";

interface HomeContextValue {
  user: UserProfile;
  setUser: Dispatch<SetStateAction<UserProfile>>;
  socketPath: string;
}

const HomeContext = createContext<HomeContextValue | null>(null);

export function useHomeContext(): HomeContextValue {
  const value = useContext(HomeContext);
  if (value === null) {
    throw new Error("useHomeContext must be used within HomeShell");
  }
  return value;
}

const primaryLinks = [
  { href: "/home", label: "Home", matches: (path: string) => path === "/home" },
  {
    href: "/home/chats",
    label: "Chats",
    matches: (path: string) => path.startsWith("/home/chats"),
  },
  {
    href: "/home/archives",
    label: "Archives",
    matches: (path: string) => path.startsWith("/home/archives"),
  },
] as const;

function PrimaryNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={mobile ? "Primary mobile navigation" : "Primary navigation"}
      className={mobile ? "flex border-t border-white/10 sm:hidden" : "hidden gap-1 sm:flex"}
    >
      {primaryLinks.map((link) => {
        const active = link.matches(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              mobile
                ? `btn-press flex-1 py-2.5 text-center text-sm font-medium transition-colors ${
                    active ? "bg-white/15 text-white" : "text-white/60"
                  }`
                : `btn-press rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function HomeShell({ children, socketPath }: { children: ReactNode; socketPath: string }) {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const updateUser: Dispatch<SetStateAction<UserProfile>> = useCallback((next) => {
    setUser((current) => {
      if (current === null) return null;
      return typeof next === "function" ? next(current) : next;
    });
  }, []);

  useEffect(() => setSessionExpiredHandler(() => router.replace("/login")), [router]);

  useEffect(() => {
    let active = true;

    void authFetch("/api/users/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("Not authenticated");
        return parseCurrentUser(await response.json());
      })
      .then((profile) => {
        if (active) setUser(profile);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        router.replace("/login");
      });

    return () => {
      active = false;
    };
  }, [router]);

  const context = useMemo(
    () => (user === null ? null : { user, setUser: updateUser, socketPath }),
    [socketPath, updateUser, user]
  );

  if (context === null) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center">
        <p role={failed ? "alert" : "status"} className="text-muted fade-in">
          {failed ? "Redirecting to sign in…" : "Loading your workspace…"}
        </p>
      </div>
    );
  }

  const currentUser = context.user;

  return (
    <HomeContext.Provider value={context}>
      <PushRegistrationSync />
      <div className="flex min-h-full flex-1 flex-col">
        <header className="glass-heavy sticky top-0 z-40 text-white">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-6">
              <Link href="/home" className="text-xl font-bold tracking-tight">
                FoC
              </Link>
              <PrimaryNavigation />
            </div>
            <div className="flex items-center gap-3">
              <Avatar url={currentUser.profilePictureUrl} size={28} ring />
              <span className="hidden text-sm text-white/80 sm:inline">{currentUser.displayName}</span>
              {currentUser.isAdmin && (
                <span className="rounded-full bg-nus-orange px-2 py-0.5 text-xs font-medium">Admin</span>
              )}
              <Link href="/login" className="text-sm text-white/70 transition-colors hover:text-white">
                Sign out
              </Link>
            </div>
          </div>
          <PrimaryNavigation mobile />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </HomeContext.Provider>
  );
}
