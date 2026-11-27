import { describe, it, expect } from 'vitest';
import { CreateJobSchema, UpdateJobSchema, LineItemSchema } from './job';

describe('LineItemSchema', () => {
  it('validates a valid line item', () => {
    const result = LineItemSchema.safeParse({
      description: 'Install outlet',
      quantity: 2,
      unitPrice: 75,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty description', () => {
    expect(
      LineItemSchema.safeParse({ description: '', quantity: 1, unitPrice: 50 })
        .success,
    ).toBe(false);
  });

  it('rejects zero quantity', () => {
    expect(
      LineItemSchema.safeParse({
        description: 'Part',
        quantity: 0,
        unitPrice: 50,
      }).success,
    ).toBe(false);
  });

  it('rejects negative quantity', () => {
    expect(
      LineItemSchema.safeParse({
        description: 'Part',
        quantity: -1,
        unitPrice: 50,
      }).success,
    ).toBe(false);
  });

  it('accepts zero unit price', () => {
    expect(
      LineItemSchema.safeParse({
        description: 'Freebie',
        quantity: 1,
        unitPrice: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects negative unit price', () => {
    expect(
      LineItemSchema.safeParse({
        description: 'Part',
        quantity: 1,
        unitPrice: -5,
      }).success,
    ).toBe(false);
  });

  it('defaults quantity to 1 when not provided', () => {
    const result = LineItemSchema.safeParse({
      description: 'Item',
      unitPrice: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(1);
  });
});

describe('CreateJobSchema', () => {
  it('validates with required fields', () => {
    const result = CreateJobSchema.safeParse({
      title: 'Outlet installation',
      opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('scheduled');
      expect(result.data.lineItems).toEqual([]);
    }
  });

  it('validates with line items', () => {
    const result = CreateJobSchema.safeParse({
      title: 'Full rewire',
      opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '550e8400-e29b-41d4-a716-446655440001',
      lineItems: [
        { description: 'Wire', quantity: 100, unitPrice: 2 },
        { description: 'Labor', quantity: 8, unitPrice: 85 },
      ],
    });
    expect(result.success).toBe(true);
  });

  // GP-034: the technician is optional on create and must be a UUID when sent.
  it('accepts an assignedTo UUID and passes it through flat', () => {
    const result = CreateJobSchema.safeParse({
      title: 'Outlet installation',
      opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '550e8400-e29b-41d4-a716-446655440001',
      assignedTo: '550e8400-e29b-41d4-a716-446655440002',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assignedTo).toBe(
        '550e8400-e29b-41d4-a716-446655440002',
      );
    }
  });

  it('leaves assignedTo absent when not sent, and rejects a non-UUID', () => {
    const absent = CreateJobSchema.safeParse({
      title: 'Outlet installation',
      opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(absent.success).toBe(true);
    if (absent.success) expect('assignedTo' in absent.data).toBe(false);
    expect(
      CreateJobSchema.safeParse({
        title: 'Outlet installation',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
        assignedTo: 'bob',
      }).success,
    ).toBe(false);
  });

  it('rejects missing title', () => {
    expect(
      CreateJobSchema.safeParse({
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid opportunityId UUID', () => {
    expect(
      CreateJobSchema.safeParse({
        title: 'Test',
        opportunityId: 'not-a-uuid',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid customerId UUID', () => {
    expect(
      CreateJobSchema.safeParse({
        title: 'Test',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: 'bad-id',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid status value', () => {
    expect(
      CreateJobSchema.safeParse({
        title: 'Test',
        opportunityId: '550e8400-e29b-41d4-a716-446655440000',
        customerId: '550e8400-e29b-41d4-a716-446655440001',
        status: 'pending',
      }).success,
    ).toBe(false);
  });

  it('accepts all valid status values', () => {
    for (const status of [
      'scheduled',
      'in_progress',
      'completed',
      'invoiced',
      'paid',
      'cancelled',
    ]) {
      expect(
        CreateJobSchema.safeParse({
          title: 'Test',
          opportunityId: '550e8400-e29b-41d4-a716-446655440000',
          customerId: '550e8400-e29b-41d4-a716-446655440001',
          status,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts scheduled dates', () => {
    const result = CreateJobSchema.safeParse({
      title: 'Test',
      opportunityId: '550e8400-e29b-41d4-a716-446655440000',
      customerId: '550e8400-e29b-41d4-a716-446655440001',
      scheduledStart: '2026-05-01T08:00:00.000Z',
      scheduledEnd: '2026-05-01T16:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateJobSchema', () => {
  it('validates partial update', () => {
    expect(UpdateJobSchema.safeParse({ status: 'in_progress' }).success).toBe(
      true,
    );
  });

  it('rejects empty update', () => {
    expect(UpdateJobSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(UpdateJobSchema.safeParse({ status: 'unknown' }).success).toBe(
      false,
    );
  });

  it('accepts updating line items array', () => {
    expect(
      UpdateJobSchema.safeParse({
        lineItems: [{ description: 'Labor', quantity: 2, unitPrice: 100 }],
      }).success,
    ).toBe(true);
  });

  it('accepts null for nullable timestamp fields', () => {
    expect(
      UpdateJobSchema.safeParse({ actualStart: null, actualEnd: null }).success,
    ).toBe(true);
  });

  it('accepts updating total', () => {
    expect(UpdateJobSchema.safeParse({ total: 1500 }).success).toBe(true);
  });

  // GP-034: a UUID reassigns, null unassigns, anything else is refused.
  it('accepts assignedTo as a UUID or null, and rejects anything else', () => {
    expect(
      UpdateJobSchema.safeParse({
        assignedTo: '550e8400-e29b-41d4-a716-446655440002',
      }).success,
    ).toBe(true);
    const unassign = UpdateJobSchema.safeParse({ assignedTo: null });
    expect(unassign.success).toBe(true);
    if (unassign.success) expect(unassign.data.assignedTo).toBeNull();
    expect(UpdateJobSchema.safeParse({ assignedTo: '' }).success).toBe(false);
    expect(UpdateJobSchema.safeParse({ assignedTo: 'bob' }).success).toBe(
      false,
    );
  });

  it('rejects negative total', () => {
    expect(UpdateJobSchema.safeParse({ total: -1 }).success).toBe(false);
  });
});
