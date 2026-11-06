"use client";

import NumberFlow from "@number-flow/react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { List, ListRow, PageHeader, Section } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { CreditBalance, CreditBalanceStatus, UserProfile } from "../_shared/types";
import { PushNotificationsCard } from "../_notifications/push-settings";
import { ArchiveAccount } from "./archive-account";

const ROLES = [
  ["requester", "Requester", "Ask others to collect things for you"],
  ["courier", "Courier", "Collect and deliver errands for credits"],
] as const;

export function AccountTab({
  user,
  selectedRoles,
  toggleRole,
  onSaveRoles,
  onSaveProfile,
  creditBalance,
  creditBalanceStatus,
  loadCreditBalance,
  signingOut,
  onSignOut,
}: {
  user: UserProfile;
  selectedRoles: string[];
  toggleRole: (role: string) => void;
  onSaveRoles: () => Promise<void>;
  onSaveProfile: (displayName: string, profilePictureUrl: string) => Promise<boolean>;
  creditBalance: CreditBalance | null;
  creditBalanceStatus: CreditBalanceStatus;
  loadCreditBalance: () => Promise<void>;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const rolesChanged =
    selectedRoles.length !== user.roles.length || selectedRoles.some((r) => !user.roles.includes(r));

  return (
    <div className="space-y-7">
      <PageHeader title="Account" />

      <List>
        <ListRow
          className="py-1"
          leading={<Avatar url={user.profilePictureUrl} name={user.displayName} size={60} />}
          title={<span className="text-[19px] font-semibold">{user.displayName}</span>}
          subtitle={<span className="[overflow-wrap:anywhere]">{user.email}</span>}
          onClick={() => setEditing(true)}
        />
      </List>

      <Section
        title="Credits"
        footer={creditBalanceStatus === "ready" ? "Reserved credits are held for errands you've requested." : undefined}
      >
        {creditBalanceStatus === "loading" && (
          <div role="status" aria-label="Loading credits" className="space-y-3 p-4">
            <div className="skeleton h-5 w-1/3 rounded" />
            <div className="skeleton h-5 w-1/4 rounded" />
          </div>
        )}
        {creditBalanceStatus === "ready" && creditBalance && (
          <ul className="pl-4 [&>li+li>div]:border-t">
            <CreditRow label="Available" value={creditBalance.creditBalance} accent />
            <CreditRow label="Reserved" value={creditBalance.reservedBalance} />
          </ul>
        )}
        {(creditBalanceStatus === "not-found" || creditBalanceStatus === "error") && (
          <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-[15px] text-muted">
              {creditBalanceStatus === "not-found"
                ? "Your credit account is still being set up."
                : "Credits are unavailable right now."}
            </p>
            <Button intent="tinted" size="sm" onClick={() => void loadCreditBalance()}>
              Retry
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="Errand roles"
        footer={
          rolesChanged ? (
            <span className="flex items-center justify-between gap-3">
              <span>Save to apply your new roles.</span>
              <Button
                size="sm"
                disabled={savingRoles}
                onClick={async () => {
                  setSavingRoles(true);
                  await onSaveRoles();
                  setSavingRoles(false);
                }}
              >
                {savingRoles ? "Saving…" : "Save"}
              </Button>
            </span>
          ) : (
            "Choose how you take part. You can hold both roles."
          )
        }
      >
        <ul className="pl-4 [&>li+li>div]:border-t">
          {ROLES.map(([role, label, hint]) => (
            <li key={role}>
              <div className="flex items-center gap-3 border-border py-2.5 pr-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px]">{label}</p>
                  <p className="text-[13px] text-muted">{hint}</p>
                </div>
                <Switch label={label} checked={selectedRoles.includes(role)} onCheckedChange={() => toggleRole(role)} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <PushNotificationsCard />

      <Section title="Security">
        <ul>
          <ListRow title="Reset password" href="/forgot-password" chevron />
        </ul>
      </Section>

      <List>
        <ListRow
          title={<span className="block text-center">{signingOut ? "Signing out…" : "Sign out"}</span>}
          tone="danger"
          chevron={false}
          onClick={signingOut ? undefined : onSignOut}
        />
      </List>

      <ArchiveAccount />

      <p className="px-4 font-mono text-xs break-all text-muted/80">ID {user.uuid}</p>

      {editing && (
        <Sheet title="Edit profile" onClose={() => setEditing(false)}>
          {(close) => <EditProfileForm user={user} onSave={onSaveProfile} onSaved={close} />}
        </Sheet>
      )}
    </div>
  );
}

function CreditRow({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <li>
      <div className="flex items-center justify-between gap-4 border-border py-3 pr-4">
        <span className="text-[15px]">{label}</span>
        <NumberFlow
          value={value}
          className={`tabular min-w-0 truncate text-[17px] font-semibold ${accent ? "text-nus-orange" : ""}`}
        />
      </div>
    </li>
  );
}

function EditProfileForm({
  user,
  onSave,
  onSaved,
}: {
  user: UserProfile;
  onSave: (displayName: string, profilePictureUrl: string) => Promise<boolean>;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [pictureUrl, setPictureUrl] = useState(user.profilePictureUrl ?? "");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const ok = await onSave(displayName, pictureUrl);
        setPending(false);
        if (ok) onSaved();
      }}
    >
      <div className="flex justify-center pt-1">
        {/* Shows the saved picture, not the half-typed URL, so input text never flows into an image source. */}
        <Avatar url={user.profilePictureUrl} name={displayName || user.displayName} size={76} />
      </div>
      <div>
        <div className="space-y-4 rounded-2xl bg-surface p-4">
          <Field label="Display name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={255}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Profile picture URL">
            <input
              type="url"
              value={pictureUrl}
              onChange={(e) => setPictureUrl(e.target.value)}
              placeholder="https://example.com/me.jpg"
              maxLength={2083}
              className={`w-full ${inputClass}`}
            />
          </Field>
        </div>
        <p className="mt-1.5 px-4 text-[13px] text-muted">Leave the picture blank to remove it.</p>
      </div>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
