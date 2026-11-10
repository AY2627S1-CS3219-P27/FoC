"use client";

import { useState } from "react";
import { toast } from "sonner";
import { pulseNavigation } from "@/lib/nav-pulse";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { EmptyState, List, ListRow, PageHeader, Pill, Section, SkeletonList } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { AdminUserErrands } from "../_errands/admin-user-errands";
import type { UserListItem } from "../_shared/types";
import { CreateUserForm } from "./create-user-form";
import { EditUserForm } from "./edit-user-form";
import { UserAdminActions } from "./user-admin-actions";

function statusOf(user: UserListItem): { label: string; tone: "danger" | "neutral" | null } {
  if (user.isLocked) return { label: "Locked", tone: "danger" };
  if (user.isArchived) return { label: "Archived", tone: "neutral" };
  return { label: "Active", tone: null };
}

export function UsersTab({
  users,
  total,
  loading,
  currentUserId,
  onUserUpdated,
  onUserCreated,
  footer,
}: {
  users: UserListItem[];
  total: number;
  loading: boolean;
  currentUserId: string;
  onUserUpdated: (user: UserListItem) => void;
  onUserCreated: (user: UserListItem) => void;
  footer: React.ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = users.find((u) => u.uuid === selectedId);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${total.toLocaleString()} registered ${total === 1 ? "user" : "users"}`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon size={15} strokeWidth={2.5} />
            New user
          </Button>
        }
      />

      {loading ? (
        <SkeletonList />
      ) : users.length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <>
          <List className="stagger">
            {users.map((u) => {
              const status = statusOf(u);
              return (
                <ListRow
                  key={u.uuid}
                  leading={<Avatar url={u.profilePictureUrl} name={u.displayName} size={36} />}
                  title={
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium" title={u.displayName}>
                        {u.displayName}
                      </span>
                      {u.isAdmin && <Pill tone="orange" className="shrink-0">Admin</Pill>}
                      {u.uuid === currentUserId && <Pill className="shrink-0">You</Pill>}
                    </span>
                  }
                  subtitle={
                    <span className="block truncate" title={u.email}>
                      {u.email}
                    </span>
                  }
                  trailing={status.tone && <Pill tone={status.tone} className="shrink-0">{status.label}</Pill>}
                  onClick={() => setSelectedId(u.uuid)}
                />
              );
            })}
          </List>
          {footer}
        </>
      )}

      {selected && (
        <UserSheet
          key={selected.uuid}
          user={selected}
          isSelf={selected.uuid === currentUserId}
          onUpdated={onUserUpdated}
          onClose={() => setSelectedId(null)}
        />
      )}

      {creating && (
        <Sheet title="New user" onClose={() => setCreating(false)}>
          {(close) => (
            <CreateUserForm<UserListItem>
              onCreated={(created) => {
                toast.success(`Created ${created.email}`, {
                  description: "They set a password with “Forgot password”.",
                });
                onUserCreated(created);
                close();
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

// A contact card for one user; their errands and details push inside the same sheet.
function UserSheet({
  user,
  isSelf,
  onUpdated,
  onClose,
}: {
  user: UserListItem;
  isSelf: boolean;
  onUpdated: (user: UserListItem) => void;
  onClose: () => void;
}) {
  const [showErrands, setShowErrands] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const status = statusOf(user);
  const back = showErrands
    ? () => setShowErrands(false)
    : showEdit
      ? () => setShowEdit(false)
      : undefined;

  return (
    <Sheet
      title={showErrands ? "Errands" : showEdit ? "Edit details" : user.displayName}
      description={showErrands ? user.displayName : undefined}
      onClose={onClose}
      onBack={back}
      backLabel="User"
    >
      {showErrands ? (
        <div key="errands" className="push-enter">
          <AdminUserErrands user={user} />
        </div>
      ) : showEdit ? (
        <div key="edit" className="push-enter">
          <EditUserForm
            user={user}
            onCancel={() => setShowEdit(false)}
            onSaved={(updated) => {
              onUpdated(updated);
              setShowEdit(false);
            }}
          />
        </div>
      ) : (
        <div key="user" className="pop-enter space-y-6">
          <div className="flex flex-col items-center pt-1 text-center">
            <Avatar url={user.profilePictureUrl} name={user.displayName} size={76} />
            <p className="mt-3 text-[22px] leading-tight font-bold break-words">{user.displayName}</p>
            <p className="mt-1 text-[15px] [overflow-wrap:anywhere] text-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {user.isAdmin && <Pill tone="orange">Admin</Pill>}
              {isSelf && <Pill>You</Pill>}
            </div>
          </div>

          <Section title="Account">
            <ul className="pl-4 [&>li+li>div]:border-t">
              <li>
                <div className="flex justify-between gap-4 border-border py-3 pr-4 text-[15px]">
                  <span>Roles</span>
                  <span className="text-right text-muted capitalize">
                    {user.roles.length ? user.roles.join(", ") : "None"}
                  </span>
                </div>
              </li>
              <li>
                <div className="flex justify-between gap-4 border-border py-3 pr-4 text-[15px]">
                  <span>Status</span>
                  <span className={status.tone === "danger" ? "text-danger" : "text-muted"}>{status.label}</span>
                </div>
              </li>
            </ul>
          </Section>

          <List>
            <ListRow
              title="Edit details"
              onClick={() => {
                pulseNavigation("forward");
                setShowEdit(true);
              }}
            />
            <ListRow
              title="Errands"
              onClick={() => {
                pulseNavigation("forward");
                setShowErrands(true);
              }}
            />
          </List>

          <UserAdminActions user={user} isSelf={isSelf} onUpdated={onUpdated} />
        </div>
      )}
    </Sheet>
  );
}
