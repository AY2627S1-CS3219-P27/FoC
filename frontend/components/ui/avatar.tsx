"use client";

import { clsx } from "clsx";
import { useState } from "react";

const LETTER = /\p{L}/u;

// First letter of the first and last words that contain a letter, so "🦊 Fox" gives "F", not "🦊F".
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).find((ch) => LETTER.test(ch)))
    .filter((ch): ch is string => !!ch);
  if (letters.length === 0) return Array.from(name.trim())[0] ?? "?";
  const first = letters[0];
  const last = letters.length > 1 ? letters[letters.length - 1] : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  url,
  name,
  size = 64,
  className,
}: {
  url: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-nus-orange/15 font-semibold text-nus-orange select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote URLs; next/image would need remotePatterns config
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
