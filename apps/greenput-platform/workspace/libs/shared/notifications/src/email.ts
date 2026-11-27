import type { NotificationEnv as Env } from './env';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export interface EmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send an email via Cloudflare MailChannels (free for Workers).
 * Falls back to console.log when EMAIL_FROM is not configured.
 */
export async function sendEmail(
  env: Env,
  payload: EmailPayload,
): Promise<EmailResult> {
  if (!env.EMAIL_FROM) {
    console.log(
      `[EMAIL-DEV] To: ${payload.to} | Subject: ${payload.subject}\n${payload.html}`,
    );
    return { success: true };
  }

  try {
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: { email: env.EMAIL_FROM, name: 'Greenput' },
        subject: payload.subject,
        content: [{ type: 'text/html', value: payload.html }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('MailChannels send failed:', response.status, text);
      return {
        success: false,
        error: `MailChannels ${response.status}: ${text}`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown email error';
    console.error('Email send error:', message);
    return { success: false, error: message };
  }
}
