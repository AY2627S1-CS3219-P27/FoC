"use client";

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
import { arriveAt } from "@/lib/nav-pulse";
import { PushRegistrationSync } from "../_notifications/push-registration";
import { RollingCubes } from "@/components/cubes";
import { ADMIN_TABS, TAB_ORDER, type Tab } from "../_shared/types";
import { AppShell, type Section } from "./app-shell";
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

// Chats and archives live on their own routes but share the app's sidebar and tab bar.
function sectionFor(pathname: string): Section {
  return pathname.startsWith("/home/archives") ? "archives" : "chats";
}

// An open conversation owns the whole phone screen, like a pushed view.
const isConversation = (pathname: string) => /^\/home\/chats\/[^/]+$/.test(pathname);

// After the sign-in pages in the flow, so arriving from them rolls the cubes forward.
const HOME_PLACE = 10;

export function HomeShell({ children, socketPath }: { children: ReactNode; socketPath: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const updateUser: Dispatch<SetStateAction<UserProfile>> = useCallback((next) => {
    setUser((current) => {
      if (current === null) return null;
      return typeof next === "function" ? next(current) : next;
    });
  }, []);

  useEffect(() => setSessionExpiredHandler(() => router.replace("/login")), [router]);
  useEffect(() => arriveAt(HOME_PLACE), []);

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
      <div
        className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-2"
        role={failed ? "alert" : "status"}
        aria-label={failed ? "Redirecting to sign in" : "Loading"}
      >
        <RollingCubes size={14} className="h-20 w-32" />
      </div>
    );
  }

  const currentUser = context.user;
  const tabs = TAB_ORDER.filter((t) => currentUser.isAdmin || !ADMIN_TABS.includes(t));

  async function signOut() {
    setSigningOut(true);
    // Revoke the refresh token server-side; leave even if that fails.
    await authFetch("/api/auth/sessions/current", { method: "DELETE" }).catch(() => null);
    router.push("/login");
  }

  function goToTab(next: Tab) {
    router.push(`/home?tab=${next}`);
  }

  return (
    <HomeContext.Provider value={context}>
      <PushRegistrationSync />
      <AppShell
        tabs={tabs}
        tab={sectionFor(pathname)}
        onTab={goToTab}
        user={currentUser}
        signingOut={signingOut}
        onSignOut={() => void signOut()}
        immersive={isConversation(pathname)}
      >
        {children}
      </AppShell>
    </HomeContext.Provider>
  );
}
