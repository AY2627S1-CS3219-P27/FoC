import { clsx } from "clsx";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-nus-blue/8 to-transparent"
      />
      <div className="fade-in relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-5 inline-flex size-14 items-center justify-center rounded-2xl bg-nus-blue shadow-raised">
            <span className="text-xl font-bold tracking-tight text-white">
              Fo<span className="text-nus-orange">C</span>
            </span>
          </div>
          <h1 className="text-[1.75rem] font-bold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-muted break-words">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function AuthCard({ className, children, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      className={clsx(
        "flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-card",
        className,
      )}
      {...props}
    >
      {children}
    </form>
  );
}
