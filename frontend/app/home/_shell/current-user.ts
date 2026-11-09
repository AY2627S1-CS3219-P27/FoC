export interface UserProfile {
  uuid: string;
  email: string;
  displayName: string;
  profilePictureUrl: string | null;
  roles: string[];
  isAdmin: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCurrentUser(value: unknown): UserProfile {
  if (!isRecord(value)) throw new Error("Current user response is invalid");

  const { uuid, email, displayName, profilePictureUrl, roles, isAdmin } = value;
  if (
    typeof uuid !== "string" ||
    typeof email !== "string" ||
    typeof displayName !== "string" ||
    (profilePictureUrl !== null && typeof profilePictureUrl !== "string") ||
    !Array.isArray(roles) ||
    !roles.every((role) => typeof role === "string") ||
    typeof isAdmin !== "boolean"
  ) {
    throw new Error("Current user response is invalid");
  }

  return {
    uuid,
    email,
    displayName,
    profilePictureUrl,
    roles,
    isAdmin,
  };
}
