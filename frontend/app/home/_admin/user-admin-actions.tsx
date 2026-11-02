"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";
import { List, ListRow } from "@/components/ui/layout";

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

// Admin rights and archiving as rows in the user's sheet. Granting or removing rights and archiving ask first; restoring doesn't.
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
    } else setError(errorText(res, "Could not update this user."));
  }

  return (
    <div>
      <List>
        <ListRow
          title={user.isAdmin ? "Remove admin rights" : "Make admin"}
          tone={user.isAdmin ? "danger" : "tint"}
          chevron={false}
          onClick={
            pending
              ? undefined
              : () =>
                  ask(
                    user.isAdmin
                      ? {
                          change: { isAdmin: false },
                          title: `Remove admin rights${isSelf ? " from yourself" : ""}?`,
                          description: isSelf
                            ? "You will lose access to the admin sections once your session refreshes."
                            : "They will lose access to the admin sections.",
                          confirmLabel: "Remove",
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
        />
        <ListRow
          title={user.isArchived ? "Restore account" : "Archive account"}
          tone={user.isArchived ? "tint" : "danger"}
          chevron={false}
          onClick={
            pending
              ? undefined
              : () =>
                  // Restoring is safe and easy to undo, so only archiving asks first.
                  user.isArchived
                    ? void update({ isArchived: false })
                    : ask({
                        change: { isArchived: true },
                        title: "Archive this account?",
                        description: "They are signed out and cannot sign in until an admin restores the account.",
                        confirmLabel: "Archive",
                        danger: true,
                      })
          }
        />
      </List>
      {error && (
        <div className="mt-2 px-4">
          <FormError>{error}</FormError>
        </div>
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
