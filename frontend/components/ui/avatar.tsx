"use client";

import { clsx } from "clsx";
import { useState } from "react";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
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
