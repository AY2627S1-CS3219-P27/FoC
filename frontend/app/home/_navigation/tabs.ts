export const HOME_TABS = [
  "errands",
  "suppliers",
  "profile",
  "users",
  "requests",
] as const;

export type HomeTab = (typeof HOME_TABS)[number];

export function parseHomeTab(value: string | null): HomeTab | null {
  return HOME_TABS.find((tab) => tab === value) ?? null;
}
