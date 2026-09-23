// email-service/templates/otp.ts
export interface OtpEmailData {
  otp: string;
  /** minutes the code stays valid; default 10 (matches user-service OTP TTL) */
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

export function renderOtpEmailHtml(data: OtpEmailData): string {
  const otp = escapeHtml(data.otp);
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
    <title>Your one-time code</title>
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
                <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">Your one-time code</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563;">${greeting} Use the code below to complete your login. It expires in ${expiresInMinutes} minutes.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#eef2ff;border:1px solid #e0e7ff;border-radius:8px;">
                  <tr>
                    <td style="padding:16px 32px;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e1b4b;">${otp}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">If you didn't request this code, you can safely ignore this email — nothing about your account has changed.</p>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;">You're receiving this because a sign-in was attempted for your ${BRAND} account.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export function renderOtpEmailText(data: OtpEmailData): string {
  const expiresInMinutes = data.expiresInMinutes ?? 10;
  const greeting = data.recipientName
    ? `Hi ${data.recipientName},`
    : 'Hi there,';

  return [
    `Your one-time ${BRAND} code`,
    '',
    greeting,
    `Code: ${data.otp}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    "If you didn't request this code, you can safely ignore this email.",
  ].join('\n');
}

/** Render both bodies for nodemailer's html and text fields. */
export function renderOtpEmail(data: OtpEmailData): {
  html: string;
  text: string;
} {
  return { html: renderOtpEmailHtml(data), text: renderOtpEmailText(data) };
}
