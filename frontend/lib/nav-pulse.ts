// Navigation tells the rolling cubes to roll once, in the direction the user moved.
export type NavDirection = "forward" | "back";

const EVENT = "foc:navigate";

export function pulseNavigation(direction: NavDirection) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<NavDirection>(EVENT, { detail: direction }));
}

// Pages call this on mount with their place in the flow. A first load stays still; arriving from another page rolls.
let lastPlace: number | null = null;

export function arriveAt(place: number) {
  if (lastPlace !== null && lastPlace !== place) pulseNavigation(place > lastPlace ? "forward" : "back");
  lastPlace = place;
}

export function onNavigation(listener: (direction: NavDirection) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<NavDirection>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
