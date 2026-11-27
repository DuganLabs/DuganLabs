import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './email';
import type { NotificationEnv as Env } from './env';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ...overrides,
  };
}

describe('sendEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should fall back to console.log when EMAIL_FROM is not set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = makeEnv();

    const result = await sendEmail(env, {
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('test@example.com'),
    );
  });

  it('should call MailChannels API when EMAIL_FROM is set', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));

    const result = await sendEmail(env, {
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>World</p>',
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.mailchannels.net/tx/v1/send',
      expect.objectContaining({ method: 'POST' }),
    );

    const callBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody.from.email).toBe('noreply@greenput.com');
    expect(callBody.personalizations[0].to[0].email).toBe('user@example.com');
    expect(callBody.subject).toBe('Hello');
  });

  it('should return error when MailChannels responds with failure', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad request', { status: 400 }),
    );

    const result = await sendEmail(env, {
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Fail</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('MailChannels 400');
  });

  it('should handle fetch exceptions gracefully', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network down'));

    const result = await sendEmail(env, {
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Fail</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network down');
  });

  it('dev log includes subject', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await sendEmail(makeEnv(), {
      to: 'test@example.com',
      subject: 'Welcome to Greenput',
      html: '<p>Hi</p>',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Welcome to Greenput'),
    );
  });

  it('mailchannels request has Content-Type application/json', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendEmail(env, {
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    });

    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('mailchannels request body includes html content', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendEmail(env, {
      to: 'u@e.com',
      subject: 'S',
      html: '<p>Hello World</p>',
    });

    const callBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody.content[0].value).toBe('<p>Hello World</p>');
    expect(callBody.content[0].type).toBe('text/html');
  });

  it('from name is Greenput in mailchannels request', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendEmail(env, { to: 'u@e.com', subject: 'S', html: '<p>Hi</p>' });

    const callBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody.from.name).toBe('Greenput');
  });

  it('non-Error exception uses unknown error message', async () => {
    const env = makeEnv({ EMAIL_FROM: 'noreply@greenput.com' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');

    const result = await sendEmail(env, {
      to: 'u@e.com',
      subject: 'S',
      html: '<p>X</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown email error');
  });
});
