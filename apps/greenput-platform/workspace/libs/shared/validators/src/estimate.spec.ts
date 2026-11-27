import { describe, it, expect } from 'vitest';
import { CreateEstimateSchema, UpdateEstimateSchema } from './estimate';

describe('CreateEstimateSchema', () => {
  const valid = {
    title: 'HVAC Installation Estimate',
    opportunityId: '550e8400-e29b-41d4-a716-446655440001',
  };

  it('accepts minimal valid input', () => {
    const result = CreateEstimateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts full valid input', () => {
    const result = CreateEstimateSchema.safeParse({
      ...valid,
      customerId: '550e8400-e29b-41d4-a716-446655440002',
      notes: 'Some notes',
      validUntil: '2025-12-31T00:00:00.000Z',
      taxRate: 8.5,
      lineItems: [{ description: 'Labor', quantity: 4, unitPrice: 7500 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = CreateEstimateSchema.safeParse({ ...valid, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing opportunityId', () => {
    const { opportunityId: _, ...rest } = valid;
    const result = CreateEstimateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid opportunityId', () => {
    const result = CreateEstimateSchema.safeParse({
      ...valid,
      opportunityId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects taxRate above 100', () => {
    const result = CreateEstimateSchema.safeParse({ ...valid, taxRate: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects negative taxRate', () => {
    const result = CreateEstimateSchema.safeParse({ ...valid, taxRate: -1 });
    expect(result.success).toBe(false);
  });

  it('defaults taxRate to 0', () => {
    const result = CreateEstimateSchema.safeParse(valid);
    expect(result.success && result.data.taxRate).toBe(0);
  });

  it('defaults lineItems to empty array', () => {
    const result = CreateEstimateSchema.safeParse(valid);
    expect(result.success && result.data.lineItems).toEqual([]);
  });
});

describe('UpdateEstimateSchema', () => {
  it('accepts partial update', () => {
    const result = UpdateEstimateSchema.safeParse({ title: 'Updated Title' });
    expect(result.success).toBe(true);
  });

  it('accepts status update', () => {
    const result = UpdateEstimateSchema.safeParse({ status: 'sent' });
    expect(result.success).toBe(true);
  });

  it('accepts line items update', () => {
    const result = UpdateEstimateSchema.safeParse({
      lineItems: [{ description: 'Parts', quantity: 2, unitPrice: 500 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = UpdateEstimateSchema.safeParse({ status: 'cancelled' });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = UpdateEstimateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts taxRate within bounds', () => {
    const result = UpdateEstimateSchema.safeParse({ taxRate: 8.875 });
    expect(result.success).toBe(true);
  });

  it('accepts taxRate of 0', () => {
    const result = UpdateEstimateSchema.safeParse({ taxRate: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts taxRate of 100', () => {
    const result = UpdateEstimateSchema.safeParse({ taxRate: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects taxRate above 100', () => {
    const result = UpdateEstimateSchema.safeParse({ taxRate: 100.1 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses', () => {
    for (const status of ['draft', 'sent', 'accepted', 'rejected', 'expired']) {
      expect(UpdateEstimateSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('accepts null customerId', () => {
    const result = UpdateEstimateSchema.safeParse({ customerId: null });
    expect(result.success).toBe(true);
  });

  it('accepts null validUntil', () => {
    const result = UpdateEstimateSchema.safeParse({ validUntil: null });
    expect(result.success).toBe(true);
  });

  it('accepts notes update', () => {
    const result = UpdateEstimateSchema.safeParse({ notes: 'Updated notes' });
    expect(result.success).toBe(true);
  });
});

describe('CreateEstimateSchema additional', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440001';

  // GP-038: the labor/material split is a field, not a "[labor] " prefix on
  // the description. A plain z.object strips unknown keys, so before `type`
  // was declared here the client could not have sent it.
  it('keeps a line item type of material', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Panel',
      opportunityId: validUuid,
      lineItems: [
        {
          type: 'material',
          description: '200A breaker',
          quantity: 1,
          unitPrice: 4500,
        },
      ],
    });
    expect(result.success && result.data.lineItems[0]?.type).toBe('material');
  });

  it('defaults a line item without a type to labor', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Panel',
      opportunityId: validUuid,
      lineItems: [{ description: 'Rough-in', quantity: 4, unitPrice: 17500 }],
    });
    expect(result.success && result.data.lineItems[0]?.type).toBe('labor');
  });

  it('rejects a line item type outside labor | material', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Panel',
      opportunityId: validUuid,
      lineItems: [
        { type: 'equipment', description: 'Lift', quantity: 1, unitPrice: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('UpdateEstimateSchema carries the line item type too', () => {
    const result = UpdateEstimateSchema.safeParse({
      lineItems: [
        { type: 'material', description: 'Pipe', quantity: 2, unitPrice: 800 },
      ],
    });
    expect(result.success && result.data.lineItems?.[0]?.type).toBe('material');
  });

  it('accepts title at max length (255 chars)', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'A'.repeat(255),
      opportunityId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it('rejects title exceeding max length (256 chars)', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'A'.repeat(256),
      opportunityId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it('defaults notes to empty string', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
    });
    expect(result.success && result.data.notes).toBe('');
  });

  it('rejects non-datetime validUntil', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
      validUntil: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('accepts taxRate of exactly 100', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
      taxRate: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects lineItem with empty description', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
      lineItems: [{ description: '', quantity: 1, unitPrice: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects lineItem with negative unitPrice', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
      lineItems: [{ description: 'Labor', quantity: 1, unitPrice: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('lineItem defaults quantity to 1 when omitted', () => {
    const result = CreateEstimateSchema.safeParse({
      title: 'Test',
      opportunityId: validUuid,
      lineItems: [{ description: 'Parts', unitPrice: 500 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lineItems[0]?.quantity).toBe(1);
    }
  });
});
