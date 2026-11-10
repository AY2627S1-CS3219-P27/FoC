'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api, errorText } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormError, inputClass } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

/** The F10.1 particulars an admin may change on another account (F11.1). */
export interface EditableUser {
  uuid: string;
  email: string;
  displayName: string;
  roles: string[];
  profilePictureUrl: string | null;
}

interface Changes {
  email?: string;
  displayName?: string;
  roles?: string[];
  profilePictureUrl?: string | null;
}

const PARTICIPANT_ROLES = ['requester', 'courier'] as const;

function canonicalRoles(roles: string[]): string[] {
  return PARTICIPANT_ROLES.filter((role) => roles.includes(role));
}

function sameRoles(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((role) => b.includes(role));
}

// Admin editor for another user's particulars. Admin status and
// archive/restore stay in UserAdminActions, which confirm those separately.
export function EditUserForm<U extends EditableUser>({
  user,
  onSaved,
  onCancel,
}: {
  user: U;
  onSaved: (user: U) => void;
  onCancel?: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [picture, setPicture] = useState(user.profilePictureUrl ?? '');
  const [roles, setRoles] = useState<string[]>(canonicalRoles(user.roles));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  // Only an email change needs confirmation: it locks the account until the
  // user proves they can read the new address.
  const [confirming, setConfirming] = useState<Changes | null>(null);

  // Diff-only payload: fields the admin left alone are never sent.
  const changes: Changes = {};
  const nextEmail = email.trim().toLowerCase();
  if (nextEmail !== user.email) changes.email = nextEmail;
  const nextName = displayName.trim();
  if (nextName !== user.displayName) changes.displayName = nextName;
  const nextPicture = picture.trim();
  if (nextPicture !== (user.profilePictureUrl ?? '')) {
    changes.profilePictureUrl = nextPicture === '' ? null : nextPicture;
  }
  if (!sameRoles(canonicalRoles(roles), canonicalRoles(user.roles))) {
    changes.roles = canonicalRoles(roles);
  }
  const dirty = Object.keys(changes).length > 0;

  async function save(body: Changes) {
    setPending(true);
    setError('');
    const res = await api<U>('PATCH', `/api/users/${user.uuid}`, {
      body,
    });
    setPending(false);
    setConfirming(null);
    if (res.ok && res.data) {
      toast.success('User updated');
      onSaved({ ...user, ...res.data });
    } else {
      setError(errorText(res, 'Could not update this user.'));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (changes.email !== undefined) setConfirming(changes);
    else void save(changes);
  }

  const toggle = (role: string) =>
    setRoles((rs) =>
      rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role],
    );

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-4 rounded-2xl bg-surface p-4">
        <Field
          label="Email"
          hint="Changing the email locks the account until they set a new password."
        >
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </Field>
        <Field label="Display name">
          <input
            required
            maxLength={255}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </Field>
        <Field
          label="Profile picture URL"
          hint="Leave empty to clear the picture."
        >
          <input
            type="url"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            className={`w-full ${inputClass}`}
            placeholder="https://…"
          />
        </Field>
      </div>

      <section>
        <h2 className="section-label mb-1.5 px-4">Roles</h2>
        <ul className="overflow-hidden rounded-2xl bg-surface [&>li+li>div]:border-t">
          {PARTICIPANT_ROLES.map((role) => (
            <li key={role} className="pl-4">
              <div className="flex items-center justify-between border-border py-2 pr-4">
                <span className="text-[15px] capitalize">{role}</span>
                <Switch
                  label={role}
                  checked={roles.includes(role)}
                  onCheckedChange={() => toggle(role)}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 px-4 text-[13px] text-muted">
          A role can only be turned off while it has no ongoing errands.
        </p>
      </section>

      {error && <FormError>{error}</FormError>}
      <div className="grid gap-2">
        <Button type="submit" size="lg" block disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {onCancel && (
          <Button intent="ghost" size="lg" block onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="Change this user's email?"
        description={
          <>
            They will be locked out until they set a new password using{' '}
            &ldquo;Forgot password&rdquo;.
          </>
        }
        confirmLabel="Change email"
        intent="danger"
        pending={pending}
        onConfirm={() => confirming && void save(confirming)}
      />
    </form>
  );
}
