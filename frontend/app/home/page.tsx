import Link from "next/link";
import { Wordmark } from "../_components/auth-shell";

// Static mock. user-service has no logout endpoint yet, so "Log out" only navigates.
export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b-2 border-line px-6 py-4">
        <Wordmark />
        <Link
          href="/login"
          className="rounded-lg border-2 border-line px-4 py-1.5 text-sm font-semibold transition-colors hover:border-ink"
        >
          Log out
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 p-6">
        <span className="w-fit -rotate-2 rounded-md bg-sun px-2 py-0.5 text-sm font-bold text-[#1b1e2b]">
          You&apos;re in!
        </span>
        <h1 className="font-display text-5xl font-extrabold tracking-tight">Hey there 👋</h1>
        <p className="text-lg text-muted">
          This is a placeholder home page for now. Errands you post and pick up will show up here soon.
        </p>
      </main>
    </div>
  );
}
