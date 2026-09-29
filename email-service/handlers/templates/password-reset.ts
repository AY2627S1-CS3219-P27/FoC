// email-service/templates/password-reset.ts
export interface PasswordResetEmailData {
  resetLink: string;
  /** minutes the link stays valid; default 10 (matches user-service reset token TTL) */
  expiresInMinutes?: number;
  recipientName?: string;
}

const BRAND = 'Friend on Campus';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPasswordResetEmailHtml(
  data: PasswordResetEmailData,
): string {
  const resetLink = escapeHtml(data.resetLink);
  const expiresInMinutes = data.expiresInMinutes ?? 10;
  const greeting = data.recipientName
    ? `Hi ${escapeHtml(data.recipientName)},`
    : 'Hi there,';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:24px 32px 0;">
                <p style="margin:0;font-size:14px;font-weight:bold;color:#4f46e5;">${BRAND}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;">
                <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">Reset your password</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563;">${greeting} We received a request to reset the password for your ${BRAND} account. Tap the button below to choose a new one. The link expires in ${expiresInMinutes} minutes.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px;">
                <a href="${resetLink}" style="display:inline-block;padding:12px 32px;background-color:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:8px;">Choose a new password</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#4b5563;word-break:break-all;">${resetLink}</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;">You're receiving this because a password reset was requested for your ${BRAND} account.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export function renderPasswordResetEmailText(
  data: PasswordResetEmailData,
): string {
  const expiresInMinutes = data.expiresInMinutes ?? 10;
  const greeting = data.recipientName
    ? `Hi ${data.recipientName},`
    : 'Hi there,';

  return [
    `Reset your ${BRAND} password`,
    '',
    greeting,
    'We received a request to reset the password for your account. Visit the link below to choose a new one.',
    `The link expires in ${expiresInMinutes} minutes.`,
    '',
    data.resetLink,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');
}

/** Render both bodies for nodemailer's html and text fields. */
export function renderPasswordResetEmail(
  data: PasswordResetEmailData,
): {
  html: string;
  text: string;
} {
  return {
    html: renderPasswordResetEmailHtml(data),
    text: renderPasswordResetEmailText(data),
  };
}