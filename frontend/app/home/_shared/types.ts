export interface UserProfile {
  uuid: string;
  email: string;
  displayName: string;
  profilePictureUrl: string | null;
  roles: string[];
  isAdmin: boolean;
}

export interface CreditBalance {
  userId: string;
  creditBalance: number;
  reservedBalance: number;
}

export type CreditBalanceStatus = "loading" | "ready" | "not-found" | "error";

export interface SupplierItem {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  categories: { id: string; name: string }[];
  building: { id: string; shortName: string } | null;
  floor: string;
  status: string;
  photoUrl: string | null;
  locationDescription?: string; // only on the single-supplier read, not the list
}

export interface BuildingItem {
  id: string;
  canonicalName: string;
  shortName: string;
  aliases?: string[];
  coordinates: { latitude: number; longitude: number };
  venueCount: number;
  allowsPin: boolean;
}

export interface CategoryItem {
  id: string;
  name: string;
}

export interface UserListItem {
  uuid: string;
  email: string;
  displayName: string;
  roles: string[];
  profilePictureUrl: string | null;
  isAdmin?: boolean;
  isLocked?: boolean;
  isArchived?: boolean;
}

export type Tab = "errands" | "suppliers" | "profile" | "users" | "requests" | "disputes";

export const TAB_ORDER: Tab[] = ["errands", "suppliers", "profile", "users", "requests", "disputes"];
export const ADMIN_TABS: Tab[] = ["users", "requests", "disputes"];

export const TAB_TITLES: Record<Tab, string> = {
  errands: "Errands",
  suppliers: "Suppliers",
  profile: "Account",
  users: "Users",
  requests: "Requests",
  disputes: "Disputes",
};

export const isTab = (value: string | null): value is Tab => TAB_ORDER.includes(value as Tab);
