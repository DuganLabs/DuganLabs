import { describe, it, expect } from 'vitest';
import {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  ConvertOpportunitySchema,
} from './opportunity';

describe('CreateOpportunitySchema', () => {
  it('validates a complete opportunity', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Kitchen rewire',
      leadId: '550e8400-e29b-41d4-a716-446655440000',
      value: 5000,
      serviceType: 'Electrical',
    });
    expect(result.success).toBe(true);
  });

  it('requires title and leadId', () => {
    expect(CreateOpportunitySchema.safeParse({}).success).toBe(false);
    expect(CreateOpportunitySchema.safeParse({ title: 'Test' }).success).toBe(
      false,
    );
  });

  it('rejects invalid leadId format', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('defaults status to open', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('open');
  });

  it('defaults value to 0', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.value).toBe(0);
  });

  it('rejects negative value', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: 'Test',
        leadId: '550e8400-e29b-41d4-a716-446655440000',
        value: -100,
      }).success,
    ).toBe(false);
  });

  it('rejects empty title', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: '',
        leadId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(false);
  });

  it('accepts nullable customerId', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: 'Test',
        leadId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: null,
      }).success,
    ).toBe(true);
  });
});

describe('UpdateOpportunitySchema', () => {
  it('validates partial update', () => {
    const result = UpdateOpportunitySchema.safeParse({
      status: 'proposal_sent',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty update', () => {
    expect(UpdateOpportunitySchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(
      UpdateOpportunitySchema.safeParse({ status: 'archived' }).success,
    ).toBe(false);
  });

  it('rejects negative value', () => {
    expect(UpdateOpportunitySchema.safeParse({ value: -1 }).success).toBe(
      false,
    );
  });

  it('accepts all valid statuses', () => {
    for (const status of [
      'open',
      'proposal_sent',
      'negotiating',
      'won',
      'lost',
    ]) {
      expect(UpdateOpportunitySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('accepts nullable closedAt', () => {
    expect(UpdateOpportunitySchema.safeParse({ closedAt: null }).success).toBe(
      true,
    );
  });
});

describe('ConvertOpportunitySchema', () => {
  it('validates with no fields', () => {
    expect(ConvertOpportunitySchema.safeParse({}).success).toBe(true);
  });

  it('validates with scheduling', () => {
    const result = ConvertOpportunitySchema.safeParse({
      scheduledStart: '2026-04-01T09:00:00.000Z',
      scheduledEnd: '2026-04-01T17:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts notes field', () => {
    expect(
      ConvertOpportunitySchema.safeParse({ notes: 'Client prefers mornings' })
        .success,
    ).toBe(true);
  });

  it('accepts title field', () => {
    expect(
      ConvertOpportunitySchema.safeParse({ title: 'Panel upgrade' }).success,
    ).toBe(true);
  });

  it('rejects invalid datetime format', () => {
    expect(
      ConvertOpportunitySchema.safeParse({ scheduledStart: '2026-04-01' })
        .success,
    ).toBe(false);
  });

  it('rejects title exceeding 255 chars', () => {
    expect(
      ConvertOpportunitySchema.safeParse({ title: 'A'.repeat(256) }).success,
    ).toBe(false);
  });
});

describe('CreateOpportunitySchema additional', () => {
  it('defaults notes to empty string', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notes).toBe('');
  });

  it('defaults serviceType to empty string', () => {
    const result = CreateOpportunitySchema.safeParse({
      title: 'Test',
      leadId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceType).toBe('');
  });

  it('rejects title exceeding 255 chars', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: 'A'.repeat(256),
        leadId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(false);
  });

  it('accepts value of 0', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: 'Test',
        leadId: '550e8400-e29b-41d4-a716-446655440000',
        value: 0,
      }).success,
    ).toBe(true);
  });

  it('accepts valid customerId UUID', () => {
    expect(
      CreateOpportunitySchema.safeParse({
        title: 'Test',
        leadId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }).success,
    ).toBe(true);
  });
});

describe('UpdateOpportunitySchema additional', () => {
  it('accepts nullable proposalSentAt', () => {
    expect(
      UpdateOpportunitySchema.safeParse({ proposalSentAt: null }).success,
    ).toBe(true);
  });

  it('accepts notes update', () => {
    expect(
      UpdateOpportunitySchema.safeParse({ notes: 'Updated notes' }).success,
    ).toBe(true);
  });

  it('rejects notes exceeding 5000 chars', () => {
    expect(
      UpdateOpportunitySchema.safeParse({ notes: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });
});
