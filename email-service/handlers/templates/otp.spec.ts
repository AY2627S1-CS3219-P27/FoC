import { describe, it, expect } from 'vitest';
import {
  renderOtpEmail,
  renderOtpEmailHtml,
  renderOtpEmailText,
} from './otp.ts';

describe('renderOtpEmailHtml', () => {
  it('escapes the OTP code', () => {
    const html = renderOtpEmailHtml({ otp: '<b>&"\'' });

    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<b>');
  });

  it('escapes the recipient name', () => {
    const html = renderOtpEmailHtml({ otp: '123456', recipientName: 'A&B' });

    expect(html).toContain('A&amp;B');
  });

  it('defaults to a 10 minute expiry when omitted', () => {
    const html = renderOtpEmailHtml({ otp: '123456' });

    expect(html).toContain('expires in 10 minutes');
  });

  it('uses the provided expiry in minutes', () => {
    const html = renderOtpEmailHtml({ otp: '123456', expiresInMinutes: 5 });

    expect(html).toContain('expires in 5 minutes');
  });

  it('greets a named recipient and falls back to a generic greeting', () => {
    expect(renderOtpEmailHtml({ otp: '123456', recipientName: 'Alice' })).toContain(
      'Hi Alice,',
    );
    expect(renderOtpEmailHtml({ otp: '123456' })).toContain('Hi there,');
  });
});

describe('renderOtpEmailText', () => {
  it('includes the code and default expiry', () => {
    const text = renderOtpEmailText({ otp: '123456' });

    expect(text).toContain('123456');
    expect(text).toContain('expires in 10 minutes');
  });
});

describe('renderOtpEmail', () => {
  it('returns both an html and a text body', () => {
    const { html, text } = renderOtpEmail({ otp: '123456' });

    expect(html).toBeTypeOf('string');
    expect(text).toBeTypeOf('string');
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('<');
  });
});