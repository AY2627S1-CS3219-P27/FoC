import Link from "next/link";

// Static mock. user-service has no logout endpoint yet, so "Log out" only navigates.
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Welcome to FoC</h1>
      <p className="text-zinc-600 dark:text-zinc-400">You are logged in (mock home page).</p>
      <Link href="/login" className="rounded border px-4 py-2">
        Log out
      </Link>
    </main>
  );
}
