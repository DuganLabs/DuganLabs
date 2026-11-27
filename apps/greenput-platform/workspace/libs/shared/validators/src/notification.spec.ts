import { describe, it, expect } from 'vitest';
import { UpdateNotificationPreferencesSchema } from './notification';

const validEntry = {
  eventType: 'new_lead' as const,
  channel: 'email' as const,
  enabled: true,
};

describe('UpdateNotificationPreferencesSchema', () => {
  it('accepts valid preferences array', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [validEntry],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple preferences', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [
        { eventType: 'new_lead', channel: 'email', enabled: true },
        { eventType: 'job_status_change', channel: 'sms', enabled: false },
        { eventType: 'payment_received', channel: 'push', enabled: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing preferences key', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty array', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid event type', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [
        { eventType: 'invalid_event', channel: 'email', enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [
        { eventType: 'new_lead', channel: 'telegram', enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [
        { eventType: 'new_lead', channel: 'email', enabled: 'yes' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing enabled field', () => {
    const result = UpdateNotificationPreferencesSchema.safeParse({
      preferences: [{ eventType: 'new_lead', channel: 'email' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid event types', () => {
    const eventTypes = [
      'new_lead',
      'job_status_change',
      'payment_received',
      'review_request',
    ] as const;
    for (const eventType of eventTypes) {
      const result = UpdateNotificationPreferencesSchema.safeParse({
        preferences: [{ eventType, channel: 'email', enabled: true }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid channels', () => {
    const channels = ['email', 'sms', 'push'] as const;
    for (const channel of channels) {
      const result = UpdateNotificationPreferencesSchema.safeParse({
        preferences: [{ eventType: 'new_lead', channel, enabled: false }],
      });
      expect(result.success).toBe(true);
    }
  });
});
