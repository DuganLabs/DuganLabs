import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchNotification, type SmsBillingHook } from './dispatcher';
import type { NotificationEnv as Env } from './env';
import * as emailModule from './email';
import * as smsModule from './sms';

function makeEnv(dbOverrides: Partial<D1Database> = {}): Env {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({}),
        }),
      }),
      batch: vi.fn().mockResolvedValue([]),
      dump: vi.fn(),
      exec: vi.fn(),
      ...dbOverrides,
    } as unknown as D1Database,
    EMAIL_FROM: 'noreply@greenput.com',
  };
}

describe('dispatchNotification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should query user preferences and send email for new_lead event', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });

    const allMock = vi.fn().mockResolvedValue({
      results: [
        {
          channel: 'email',
          enabled: 1,
          user_id: 'u1',
          user_email: 'tech@example.com',
        },
      ],
    });
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ all: allMock, run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'new_lead',
      workspaceId: 'w1',
      leadName: 'Bob Builder',
      source: 'website',
    });

    expect(prepareMock).toHaveBeenCalled();
    expect(sendEmailSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: 'tech@example.com',
        subject: expect.stringContaining('Bob Builder'),
      }),
    );
  });

  it('should send SMS when user preference is sms', async () => {
    const sendSmsSpy = vi
      .spyOn(smsModule, 'sendSms')
      .mockResolvedValue({ success: true });

    const allMock = vi.fn().mockResolvedValue({
      results: [
        {
          channel: 'sms',
          enabled: 1,
          user_id: 'u1',
          user_email: '+15551234567',
        },
      ],
    });
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ all: allMock, run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'payment_received',
      workspaceId: 'w1',
      jobNumber: 'J-001',
      amount: 500,
    });

    expect(sendSmsSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: '+15551234567',
        body: expect.stringContaining('J-001'),
      }),
    );
  });

  it('should default to email when no preferences exist for a user', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });

    const allMock = vi.fn().mockResolvedValue({
      results: [
        {
          channel: null,
          enabled: null,
          user_id: 'u1',
          user_email: 'owner@example.com',
        },
      ],
    });
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ all: allMock, run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'job_status_change',
      workspaceId: 'w1',
      jobNumber: 'J-002',
      oldStatus: 'scheduled',
      newStatus: 'in_progress',
    });

    expect(sendEmailSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ to: 'owner@example.com' }),
    );
  });

  it('should skip users with disabled preferences', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });

    const allMock = vi.fn().mockResolvedValue({
      results: [
        {
          channel: 'email',
          enabled: 0,
          user_id: 'u1',
          user_email: 'user@example.com',
        },
      ],
    });
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ all: allMock, run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'new_lead',
      workspaceId: 'w1',
      leadName: 'Test',
      source: 'manual',
    });

    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('should send directly to customer for review_request events', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });
    const sendSmsSpy = vi
      .spyOn(smsModule, 'sendSms')
      .mockResolvedValue({ success: true });

    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'review_request',
      workspaceId: 'w1',
      customerName: 'Jane',
      customerEmail: 'jane@example.com',
      customerPhone: '+15559999999',
      jobTitle: 'Panel Upgrade',
    });

    expect(sendEmailSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ to: 'jane@example.com' }),
    );
    expect(sendSmsSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ to: '+15559999999' }),
    );
  });

  it('should do nothing when no workspace users exist', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });

    const allMock = vi.fn().mockResolvedValue({ results: [] });
    const bindMock = vi.fn().mockReturnValue({ all: allMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(env, {
      type: 'new_lead',
      workspaceId: 'w1',
      leadName: 'Test',
      source: 'manual',
    });

    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('bills SMS through the injected hook and does not call the shared sender', async () => {
    const sendSmsSpy = vi
      .spyOn(smsModule, 'sendSms')
      .mockResolvedValue({ success: true });
    const hook: SmsBillingHook = {
      send: vi.fn().mockResolvedValue({ ok: true, sid: 'SM_hook' }),
    };
    const { env } = prefsEnv([
      {
        channel: 'sms',
        enabled: 1,
        user_id: 'u1',
        user_email: '+15551234567',
      },
    ]);

    await dispatchNotification(
      env,
      {
        type: 'new_lead',
        workspaceId: 'w1',
        leadName: 'Ada',
        source: 'website',
      },
      { smsBilling: hook },
    );

    expect(hook.send).toHaveBeenCalledWith({
      workspaceId: 'w1',
      to: '+15551234567',
      body: expect.stringContaining('Ada'),
    });
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it('emails a lead alert when the hook reports the balance is exhausted', async () => {
    const sendSmsSpy = vi
      .spyOn(smsModule, 'sendSms')
      .mockResolvedValue({ success: true });
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });
    const hook: SmsBillingHook = {
      send: vi.fn().mockResolvedValue({ ok: false, reason: 'USAGE_EXHAUSTED' }),
    };
    const { env, logged } = prefsEnv([
      {
        channel: 'sms',
        enabled: 1,
        user_id: 'u1',
        user_email: 'owner@example.com',
      },
    ]);

    await dispatchNotification(
      env,
      {
        type: 'new_lead',
        workspaceId: 'w1',
        leadName: 'Ada',
        source: 'website',
      },
      { smsBilling: hook },
    );

    expect(sendSmsSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        to: 'owner@example.com',
        subject: expect.stringContaining('Ada'),
      }),
    );
    const sms = logged.find((args) => args[3] === 'sms');
    const email = logged.find((args) => args[3] === 'email');
    expect(sms?.[6]).toBe('failed');
    expect(sms?.[7]).toBe('USAGE_EXHAUSTED');
    expect(email?.[6]).toBe('sent');
  });

  it('does not send a second email when email was already selected', async () => {
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });
    const hook: SmsBillingHook = {
      send: vi.fn().mockResolvedValue({ ok: false, reason: 'USAGE_EXHAUSTED' }),
    };
    const { env } = prefsEnv([
      {
        channel: 'email',
        enabled: 1,
        user_id: 'u1',
        user_email: 'owner@example.com',
      },
      {
        channel: 'sms',
        enabled: 1,
        user_id: 'u1',
        user_email: 'owner@example.com',
      },
    ]);

    await dispatchNotification(
      env,
      {
        type: 'new_lead',
        workspaceId: 'w1',
        leadName: 'Ada',
        source: 'website',
      },
      { smsBilling: hook },
    );

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  it('emails the customer when a billed review-request SMS is blocked', async () => {
    const sendSmsSpy = vi
      .spyOn(smsModule, 'sendSms')
      .mockResolvedValue({ success: true });
    const sendEmailSpy = vi
      .spyOn(emailModule, 'sendEmail')
      .mockResolvedValue({ success: true });
    const hook: SmsBillingHook = {
      send: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'SEND_FAILED',
        error: 'Twilio 500',
      }),
    };
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
    const env = makeEnv();
    (env.DB as unknown as { prepare: typeof prepareMock }).prepare =
      prepareMock;

    await dispatchNotification(
      env,
      {
        type: 'review_request',
        workspaceId: 'w1',
        customerName: 'Jane',
        customerEmail: 'jane@example.com',
        customerPhone: '+15559999999',
        jobTitle: 'Panel Upgrade',
      },
      { smsBilling: hook },
    );

    expect(hook.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15559999999', workspaceId: 'w1' }),
    );
    expect(sendSmsSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ to: 'jane@example.com' }),
    );
  });
});

function prefsEnv(
  results: Array<{
    channel: string | null;
    enabled: number | null;
    user_id: string;
    user_email: string;
  }>,
): { env: Env; logged: unknown[][] } {
  const logged: unknown[][] = [];
  const allMock = vi.fn().mockResolvedValue({ results });
  const runMock = vi.fn().mockResolvedValue({});
  const bindMock = vi.fn().mockImplementation((...args: unknown[]) => {
    if (args.length > 2) logged.push(args);
    return { all: allMock, run: runMock };
  });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  const env = makeEnv();
  (env.DB as unknown as { prepare: typeof prepareMock }).prepare = prepareMock;
  return { env, logged };
}
