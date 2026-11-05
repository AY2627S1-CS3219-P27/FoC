"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export interface AdminUserFlags {
  uuid: string;
  isAdmin?: boolean;
  isArchived?: boolean;
}

export function UserAdminActions<U extends AdminUserFlags>({
  user,
  isSelf,
  onUpdated,
}: {
  user: U;
  isSelf: boolean;
  onUpdated: (user: U) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function update(change: { isAdmin?: boolean; isArchived?: boolean }, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    setError("");
    const res = await api<Partial<U>>("PATCH", `/api/users/${user.uuid}`, { body: change });
    setPending(false);
    if (res.ok && res.data) onUpdated({ ...user, ...res.data });
    else setError(`${res.status} ${res.message ?? res.code ?? "Update failed."}`);
  }

  const button =
    "btn-press text-xs rounded-lg border px-2 py-1 font-medium transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        disabled={pending}
        onClick={() =>
          update(
            { isAdmin: !user.isAdmin },
            user.isAdmin
              ? `Remove admin rights${isSelf ? " from yourself" : ""}?`
              : "Make this user an admin?",
          )
        }
        className={`${button} border-nus-blue/40 text-nus-blue hover:bg-nus-blue/10`}
      >
        {user.isAdmin ? "Remove admin" : "Make admin"}
      </button>
      <button
        disabled={pending}
        onClick={() =>
          update(
            { isArchived: !user.isArchived },
            user.isArchived ? "Restore this account?" : "Archive this account?",
          )
        }
        className={`${button} ${
          user.isArchived
            ? "border-success/40 text-success hover:bg-success/10"
            : "border-danger/40 text-danger hover:bg-danger/10"
        }`}
      >
        {user.isArchived ? "Unarchive" : "Archive"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger w-full">
          {error}
        </span>
      )}
    </div>
  );
}
