import { describe, it, expect } from 'vitest';
import { CreateCampaignSchema, UpdateCampaignSchema } from './campaign';

describe('CreateCampaignSchema', () => {
  it('validates with required fields and defaults status to draft', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Summer Promo',
      channel: 'email',
      startDate: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
  });

  it('accepts all valid channels', () => {
    const channels = ['email', 'sms', 'postcard', 'social', 'google'];
    for (const channel of channels) {
      expect(
        CreateCampaignSchema.safeParse({
          name: 'Test',
          channel,
          startDate: '2026-06-01T00:00:00.000Z',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects missing name', () => {
    expect(
      CreateCampaignSchema.safeParse({
        channel: 'sms',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: '',
        channel: 'email',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid channel', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'Test',
        channel: 'radio',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects non-datetime startDate', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'Test',
        channel: 'email',
        startDate: '2026-06-01',
      }).success,
    ).toBe(false);
  });

  it('accepts all valid statuses', () => {
    const statuses = ['draft', 'active', 'paused', 'completed'];
    for (const status of statuses) {
      expect(
        CreateCampaignSchema.safeParse({
          name: 'Test',
          channel: 'email',
          startDate: '2026-06-01T00:00:00.000Z',
          status,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts optional budget and spent', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Budget Campaign',
      channel: 'google',
      startDate: '2026-06-01T00:00:00.000Z',
      budget: 5000,
      spent: 1000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budget).toBe(5000);
      expect(result.data.spent).toBe(1000);
    }
  });

  it('rejects negative budget', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'Test',
        channel: 'email',
        startDate: '2026-06-01T00:00:00.000Z',
        budget: -100,
      }).success,
    ).toBe(false);
  });

  it('defaults notes, targetArea, budget, spent, endDate', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Test',
      channel: 'sms',
      startDate: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('');
      expect(result.data.targetArea).toBeNull();
      expect(result.data.budget).toBeNull();
      expect(result.data.spent).toBe(0);
      expect(result.data.endDate).toBeNull();
    }
  });
});

describe('UpdateCampaignSchema', () => {
  it('validates partial update with status', () => {
    expect(UpdateCampaignSchema.safeParse({ status: 'active' }).success).toBe(
      true,
    );
  });

  it('validates partial update with budget', () => {
    expect(UpdateCampaignSchema.safeParse({ budget: 5000 }).success).toBe(true);
  });

  it('rejects empty update', () => {
    expect(UpdateCampaignSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(UpdateCampaignSchema.safeParse({ status: 'archived' }).success).toBe(
      false,
    );
  });

  it('validates name update', () => {
    expect(UpdateCampaignSchema.safeParse({ name: 'New Name' }).success).toBe(
      true,
    );
  });

  it('rejects negative spent', () => {
    expect(UpdateCampaignSchema.safeParse({ spent: -50 }).success).toBe(false);
  });

  it('accepts leadsGenerated as integer', () => {
    expect(UpdateCampaignSchema.safeParse({ leadsGenerated: 5 }).success).toBe(
      true,
    );
  });

  it('rejects leadsGenerated as negative', () => {
    expect(UpdateCampaignSchema.safeParse({ leadsGenerated: -1 }).success).toBe(
      false,
    );
  });

  it('accepts null endDate', () => {
    expect(UpdateCampaignSchema.safeParse({ endDate: null }).success).toBe(
      true,
    );
  });
});

describe('CreateCampaignSchema additional', () => {
  it('rejects name exceeding max length (201 chars)', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'A'.repeat(201),
        channel: 'email',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts name at max length (200 chars)', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'A'.repeat(200),
        channel: 'email',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts null budget', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Test',
      channel: 'email',
      startDate: '2026-06-01T00:00:00.000Z',
      budget: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.budget).toBeNull();
  });

  it('rejects missing channel', () => {
    expect(
      CreateCampaignSchema.safeParse({
        name: 'Test',
        startDate: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
