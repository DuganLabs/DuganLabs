import { describe, it, expect } from 'vitest';
import { CreateWebhookSchema, UpdateWebhookSchema } from './webhook';

describe('CreateWebhookSchema', () => {
  it('validates a valid webhook with events', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['lead.created', 'job.completed'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid URL', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'not-a-url',
      events: ['lead.created'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty events array', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects URL exceeding 2048 chars', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/' + 'a'.repeat(2030),
      events: ['lead.created'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing url field', () => {
    const result = CreateWebhookSchema.safeParse({ events: ['lead.created'] });
    expect(result.success).toBe(false);
  });

  it('rejects missing events field', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
    });
    expect(result.success).toBe(false);
  });

  it('accepts single event in array', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['lead.created'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.events).toHaveLength(1);
  });

  it('accepts wildcard-style event names', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://hooks.slack.com/services/T000/B000/xxx',
      events: ['lead.*', 'job.*'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts HTTPS and HTTP URLs', () => {
    expect(
      CreateWebhookSchema.safeParse({
        url: 'http://localhost:3000/webhook',
        events: ['lead.created'],
      }).success,
    ).toBe(true);
  });
});

describe('UpdateWebhookSchema', () => {
  it('allows partial updates (url only)', () => {
    const result = UpdateWebhookSchema.safeParse({
      url: 'https://example.com/new-hook',
    });
    expect(result.success).toBe(true);
  });

  it('allows partial updates (active only)', () => {
    const result = UpdateWebhookSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
  });

  it('allows partial updates (events only)', () => {
    const result = UpdateWebhookSchema.safeParse({ events: ['lead.created'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = UpdateWebhookSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL in update', () => {
    const result = UpdateWebhookSchema.safeParse({ url: 'bad-url' });
    expect(result.success).toBe(false);
  });

  it('rejects empty events array in update', () => {
    const result = UpdateWebhookSchema.safeParse({ events: [] });
    expect(result.success).toBe(false);
  });

  it('accepts all three fields at once', () => {
    const result = UpdateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['lead.created', 'job.completed'],
      active: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts active: true (boolean only)', () => {
    expect(UpdateWebhookSchema.safeParse({ active: true }).success).toBe(true);
  });

  it('rejects active as string', () => {
    expect(UpdateWebhookSchema.safeParse({ active: 'yes' }).success).toBe(
      false,
    );
  });
});

describe('CreateWebhookSchema additional', () => {
  it('rejects event string exceeding 100 chars', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['a'.repeat(101)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects event that is an empty string', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: [''],
    });
    expect(result.success).toBe(false);
  });

  it('accepts URL at exactly 2048 characters', () => {
    const base = 'https://example.com/';
    const url = base + 'a'.repeat(2048 - base.length);
    const result = CreateWebhookSchema.safeParse({
      url,
      events: ['lead.created'],
    });
    expect(result.success).toBe(true);
  });

  it('preserves all events in parsed data', () => {
    const events = ['lead.created', 'job.completed', 'payment.received'];
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.events).toHaveLength(3);
  });
});
