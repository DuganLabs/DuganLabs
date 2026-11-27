import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSms } from './sms';
import type { NotificationEnv as Env } from './env';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ...overrides,
  };
}

describe('sendSms', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should fall back to console.log when Twilio is not configured', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = makeEnv();

    const result = await sendSms(env, {
      to: '+15551234567',
      body: 'Hello',
    });

    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('+15551234567'),
    );
  });

  it('should call Twilio API when credentials are set', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
      );

    const result = await sendSms(env, {
      to: '+15551234567',
      body: 'Test message',
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC_TEST/Messages.json',
      expect.objectContaining({ method: 'POST' }),
    );

    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(callInit.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${btoa('AC_TEST:token123')}`,
      }),
    );

    const body = new URLSearchParams(callInit.body as string);
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toBe('Test message');
    expect(body.get('StatusCallback')).toBeNull();
    expect(result.sid).toBe('SM123');
  });

  it('sends StatusCallback when one is given', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: 'SM999' }), { status: 201 }),
      );
    await sendSms(env, {
      to: '+15551234567',
      body: 'Test message',
      statusCallback: 'https://api.greenput.com/api/webhooks/twilio/sms',
    });
    const callInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(callInit.body as string);
    expect(body.get('StatusCallback')).toBe(
      'https://api.greenput.com/api/webhooks/twilio/sms',
    );
  });

  it('should return error when Twilio responds with failure', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const result = await sendSms(env, {
      to: '+15551234567',
      body: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Twilio 401');
  });

  it('should handle fetch exceptions gracefully', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'));

    const result = await sendSms(env, {
      to: '+15551234567',
      body: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Timeout');
  });

  it('falls back to dev log when only SID is missing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = makeEnv({
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    const result = await sendSms(env, { to: '+15559999999', body: 'Hi' });
    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalled();
  });

  it('falls back to dev log when only auth token is missing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    const result = await sendSms(env, { to: '+15559999999', body: 'Hi' });
    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalled();
  });

  it('dev log includes recipient phone number', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await sendSms(makeEnv(), { to: '+15551112222', body: 'Test message' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('+15551112222'),
    );
  });

  it('twilio request uses application/x-www-form-urlencoded content type', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
      );

    await sendSms(env, { to: '+15551234567', body: 'Hi' });

    const callInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('non-Error exception uses unknown error message', async () => {
    const env = makeEnv({
      TWILIO_ACCOUNT_SID: 'AC_TEST',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: '+15550001111',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error');

    const result = await sendSms(env, { to: '+15551234567', body: 'Hi' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown SMS error');
  });
});
