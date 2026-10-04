import Link from "next/link";

// Sample errands for the side panel; purely decorative.
const notes = [
  { what: "Iced Milo from the Deck", where: "drop at COM1 lobby", tilt: "-rotate-2" },
  { what: "Print 20 pages, double-sided", where: "pick up at Central Library", tilt: "rotate-1" },
  { what: "Grab my parcel", where: "PGP mailroom → UTown", tilt: "-rotate-1" },
];

export function Wordmark() {
  return (
    <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
      FoC<span className="text-accent">.</span>
    </Link>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid flex-1 grid-cols-1 md:grid-cols-[1fr_minmax(0,32rem)]">
      <aside className="hidden flex-col justify-between bg-sun p-10 text-[#1b1e2b] md:flex">
        <Wordmark />
        <div className="max-w-md">
          <h2 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight">
            Someone&apos;s already heading there.
          </h2>
          <p className="mt-4 text-lg">
            Post a small errand, and a fellow student on the way picks it up.
            Or run one yourself and earn credits.
          </p>
          <ul className="mt-10 flex flex-col gap-3">
            {notes.map((n) => (
              <li
                key={n.what}
                className={`${n.tilt} w-fit rounded-md border-2 border-[#1b1e2b] bg-white px-4 py-3 shadow-[4px_4px_0_#1b1e2b]`}
              >
                <p className="font-semibold">{n.what}</p>
                <p className="text-sm text-[#5b6070]">{n.where}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm">Made by students, for students.</p>
      </aside>

      <section className="flex flex-col p-6 sm:p-10">
        <div className="md:hidden">
          <Wordmark />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children}
        </div>
      </section>
    </main>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <input
        {...props}
        className="rounded-lg border-2 border-line bg-card px-3 py-2.5 outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      disabled={pending}
      className="mt-2 rounded-lg bg-accent px-4 py-3 font-semibold text-accent-ink transition hover:brightness-110 active:translate-y-px disabled:cursor-wait disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border-l-4 border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
