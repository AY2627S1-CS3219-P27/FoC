"use client";

import { useState } from "react";

export function Avatar({ url, size = 64, ring = false }: { url: string | null; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const showImage = !!url && !broken;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-muted"
      style={{
        width: size,
        height: size,
        boxShadow: ring ? "0 0 0 2px rgba(255,255,255,0.35)" : undefined,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote URLs; next/image would need remotePatterns config
        <img
          src={url}
          alt="Profile picture"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z" />
        </svg>
      )}
    </span>
  );
}
