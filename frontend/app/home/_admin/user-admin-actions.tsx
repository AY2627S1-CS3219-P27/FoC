"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface AdminUserFlags {
  uuid: string;
  isAdmin?: boolean;
  isArchived?: boolean;
}

type Change = { isAdmin?: boolean; isArchived?: boolean };

interface Pending {
  change: Change;
  title: string;
  description: string;
  confirmLabel: string;
  danger: boolean;
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
  const [confirming, setConfirming] = useState<Pending | null>(null);
  // Kept after closing so the dialog does not go blank while it animates out.
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function ask(p: Pending) {
    setConfirming(p);
    setOpen(true);
  }

  async function update(change: Change) {
    setPending(true);
    setError("");
    const res = await api<Partial<U>>("PATCH", `/api/users/${user.uuid}`, { body: change });
    setPending(false);
    setOpen(false);
    if (res.ok && res.data) {
      onUpdated({ ...user, ...res.data });
      toast.success("User updated");
    } else setError(`${res.status} ${res.message ?? res.code ?? "Update failed."}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="xs"
        intent="blue-outline"
        disabled={pending}
        onClick={() =>
          ask(
            user.isAdmin
              ? {
                  change: { isAdmin: false },
                  title: `Remove admin rights${isSelf ? " from yourself" : ""}?`,
                  description: isSelf
                    ? "You will lose access to the admin tabs once your session refreshes."
                    : "They will lose access to the admin tabs.",
                  confirmLabel: "Remove admin",
                  danger: true,
                }
              : {
                  change: { isAdmin: true },
                  title: "Make this user an admin?",
                  description: "They will be able to manage users, suppliers and requests.",
                  confirmLabel: "Make admin",
                  danger: false,
                },
          )
        }
      >
        {user.isAdmin ? "Remove admin" : "Make admin"}
      </Button>
      <Button
        size="xs"
        intent={user.isArchived ? "success-outline" : "danger-outline"}
        disabled={pending}
        onClick={() =>
          ask(
            user.isArchived
              ? {
                  change: { isArchived: false },
                  title: "Restore this account?",
                  description: "They will be able to sign in again.",
                  confirmLabel: "Unarchive",
                  danger: false,
                }
              : {
                  change: { isArchived: true },
                  title: "Archive this account?",
                  description: "They are signed out and cannot sign in until an admin restores the account.",
                  confirmLabel: "Archive",
                  danger: true,
                },
          )
        }
      >
        {user.isArchived ? "Unarchive" : "Archive"}
      </Button>
      {error && (
        <span role="alert" className="w-full text-xs break-words text-danger">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={confirming?.title ?? ""}
        description={confirming?.description ?? ""}
        confirmLabel={confirming?.confirmLabel ?? ""}
        intent={confirming?.danger ? "danger" : "primary"}
        pending={pending}
        onConfirm={() => confirming && void update(confirming.change)}
      />
    </div>
  );
}
