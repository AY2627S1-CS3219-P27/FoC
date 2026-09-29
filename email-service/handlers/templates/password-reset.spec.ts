import { describe, it, expect } from 'vitest';
import {
  renderPasswordResetEmail,
  renderPasswordResetEmailHtml,
  renderPasswordResetEmailText,
} from './password-reset.ts';

const LINK = 'https://foc.example/reset-password?token=abc';

describe('renderPasswordResetEmailHtml', () => {
  it('emits the reset link in a clickable button href', () => {
    const html = renderPasswordResetEmailHtml({ resetLink: LINK });

    expect(html).toContain(`href="${LINK}"`);
  });

  it('escapes the reset link', () => {
    const html = renderPasswordResetEmailHtml({
      resetLink: `https://foc.example/reset-password?token=${'<b>&"\'"}'}`,
    });

    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<b>');
  });

  it('escapes the recipient name', () => {
    const html = renderPasswordResetEmailHtml({
      resetLink: LINK,
      recipientName: 'A&B',
    });

    expect(html).toContain('A&amp;B');
  });

  it('defaults to a 10 minute expiry when omitted', () => {
    const html = renderPasswordResetEmailHtml({ resetLink: LINK });

    expect(html).toContain('expires in 10 minutes');
  });

  it('uses the provided expiry in minutes', () => {
    const html = renderPasswordResetEmailHtml({
      resetLink: LINK,
      expiresInMinutes: 5,
    });

    expect(html).toContain('expires in 5 minutes');
  });

  it('greets a named recipient and falls back to a generic greeting', () => {
    expect(
      renderPasswordResetEmailHtml({ resetLink: LINK, recipientName: 'Alice' }),
    ).toContain('Hi Alice,');
    expect(renderPasswordResetEmailHtml({ resetLink: LINK })).toContain(
      'Hi there,',
    );
  });
});

describe('renderPasswordResetEmailText', () => {
  it('includes the link and default expiry', () => {
    const text = renderPasswordResetEmailText({ resetLink: LINK });

    expect(text).toContain(LINK);
    expect(text).toContain('expires in 10 minutes');
  });
});

describe('renderPasswordResetEmail', () => {
  it('returns both an html and a text body', () => {
    const { html, text } = renderPasswordResetEmail({ resetLink: LINK });

    expect(html).toBeTypeOf('string');
    expect(text).toBeTypeOf('string');
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('<');
  });
});