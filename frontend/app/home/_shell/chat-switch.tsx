import { clsx } from 'clsx';
import Link from 'next/link';

const ITEMS = [
  { key: 'chats', href: '/home/chats', label: 'Active' },
  { key: 'archives', href: '/home/archives', label: 'Archived' },
] as const;

// Same look as the segmented control, but each segment is a real link to its own route.
export function ChatSwitch({ current }: { current: 'chats' | 'archives' }) {
  return (
    <nav
      aria-label="Conversations"
      className="mb-5 flex w-full rounded-[9px] bg-fill p-0.5 sm:inline-flex sm:w-auto"
    >
      {ITEMS.map((item) => {
        const active = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            replace
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex h-8 flex-1 items-center sm:flex-none justify-center rounded-[7px] px-3 text-[13px] transition-[background-color,box-shadow,color] duration-200 sm:px-5',
              active
                ? 'bg-surface font-semibold text-foreground shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:bg-[#636366]'
                : 'font-medium text-foreground/80',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
