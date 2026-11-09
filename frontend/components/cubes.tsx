"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { onNavigation, type NavDirection } from "@/lib/nav-pulse";

const COLORS = ["var(--nus-orange)", "var(--nus-blue-light)", "var(--nus-orange)"];
const ROLL_MS = 440;
const STAGGER_MS = 110;
const TOTAL_MS = ROLL_MS + STAGGER_MS * (COLORS.length - 1);

// Brand mark: three cubes on an isometric floor. Still until the user navigates, then each rolls one tile that way.
export function RollingCubes({ size = 10, className }: { size?: number; className?: string }) {
  const [roll, setRoll] = useState<NavDirection | null>(null);
  const queued = useRef<NavDirection | null>(null);
  const rolling = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    function start(direction: NavDirection) {
      rolling.current = true;
      setRoll(direction);
      timer = setTimeout(() => {
        setRoll(null);
        rolling.current = false;
        const next = queued.current;
        queued.current = null;
        // One frame at rest, so the next roll restarts its animation from the landed pose.
        if (next) frame = requestAnimationFrame(() => start(next));
      }, TOTAL_MS);
    }

    const off = onNavigation((direction) => {
      // A roll in flight finishes; at most one more follows, so rapid taps don't build a backlog.
      if (rolling.current) queued.current = direction;
      else start(direction);
    });
    return () => {
      off();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, []);

  const n = COLORS.length;
  return (
    <div
      aria-hidden="true"
      data-roll={roll ?? undefined}
      className={clsx("cubes", className)}
      style={
        {
          "--s": `${size}px`,
          "--roll": `${ROLL_MS}ms`,
          "--roll-total": `${TOTAL_MS}ms`,
        } as React.CSSProperties
      }
    >
      <div className="cubes-world">
        <div className="cubes-pan">
          <div className="cubes-floor" />
          {COLORS.map((c, i) => {
            // The cube in front leads: last index first going forward, first index first going back.
            const order = roll === "back" ? i : n - 1 - i;
            return (
              <div
                key={i}
                className="cube"
                style={
                  {
                    "--c": c,
                    "--delay": `${order * STAGGER_MS}ms`,
                    left: `calc(var(--pitch) * ${i - (n - 1) / 2} - var(--s) / 2)`,
                  } as React.CSSProperties
                }
              >
                <div className="cube-face cube-ny" />
                <div className="cube-face cube-nx" />
                <div className="cube-face cube-py" />
                <div className="cube-face cube-px" />
                <div className="cube-face cube-top" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
