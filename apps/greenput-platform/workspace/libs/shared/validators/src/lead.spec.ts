import { describe, it, expect } from 'vitest';
import {
  CreateLeadSchema,
  UpdateLeadSchema,
  ConvertLeadSchema,
  WithdrawLeadSchema,
} from './lead';

describe('CreateLeadSchema', () => {
  it('validates a complete lead', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '555-0100',
      source: 'website',
      serviceType: 'Electrical',
      estimatedValue: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('validates with only required fields', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Smith',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('new');
      expect(result.data.source).toBe('manual');
    }
  });

  it('rejects missing firstName', () => {
    const result = CreateLeadSchema.safeParse({ lastName: 'Doe' });
    expect(result.success).toBe(false);
  });

  it('rejects missing lastName', () => {
    const result = CreateLeadSchema.safeParse({ firstName: 'John' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      email: 'not-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative estimatedValue', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      estimatedValue: -100,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses', () => {
    const statuses = [
      'new',
      'contacted',
      'qualified',
      'unqualified',
      'converted',
    ] as const;
    for (const status of statuses) {
      const result = CreateLeadSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid sources', () => {
    const sources = [
      'website',
      'referral',
      'campaign',
      'manual',
      'google',
      'nextdoor',
      'other',
    ] as const;
    for (const source of sources) {
      const result = CreateLeadSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        source,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid source', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'A',
      lastName: 'B',
      source: 'tiktok',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateLeadSchema', () => {
  it('validates a partial update', () => {
    const result = UpdateLeadSchema.safeParse({ status: 'contacted' });
    expect(result.success).toBe(true);
  });

  it('rejects empty update', () => {
    const result = UpdateLeadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid status in update', () => {
    const result = UpdateLeadSchema.safeParse({ status: 'bogus' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses in update', () => {
    const statuses = [
      'new',
      'contacted',
      'qualified',
      'unqualified',
      'converted',
    ] as const;
    for (const status of statuses) {
      expect(UpdateLeadSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('accepts notes update', () => {
    expect(
      UpdateLeadSchema.safeParse({ notes: 'Called back, interested' }).success,
    ).toBe(true);
  });
});

describe('ConvertLeadSchema', () => {
  it('validates with optional fields', () => {
    const result = ConvertLeadSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates with title and value', () => {
    const result = ConvertLeadSchema.safeParse({
      title: 'New Opportunity',
      value: 3000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative value', () => {
    expect(ConvertLeadSchema.safeParse({ value: -1 }).success).toBe(false);
  });

  it('accepts zero value', () => {
    expect(ConvertLeadSchema.safeParse({ value: 0 }).success).toBe(true);
  });

  it('rejects title exceeding 255 chars', () => {
    expect(
      ConvertLeadSchema.safeParse({ title: 'A'.repeat(256) }).success,
    ).toBe(false);
  });

  it('accepts title at exactly 255 chars', () => {
    expect(
      ConvertLeadSchema.safeParse({ title: 'A'.repeat(255) }).success,
    ).toBe(true);
  });
});

describe('CreateLeadSchema additional', () => {
  it('defaults notes to empty string', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('');
    }
  });

  it('defaults campaignId to null', () => {
    const result = CreateLeadSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.campaignId).toBeNull();
    }
  });

  it('accepts valid campaignId UUID', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        campaignId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
  });

  it('rejects non-UUID campaignId', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        campaignId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('accepts null campaignId', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        campaignId: null,
      }).success,
    ).toBe(true);
  });

  it('rejects firstName exceeding 100 chars', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'A'.repeat(101),
        lastName: 'Smith',
      }).success,
    ).toBe(false);
  });

  it('rejects phone exceeding 20 chars', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        phone: '1'.repeat(21),
      }).success,
    ).toBe(false);
  });

  it('rejects notes exceeding 5000 chars', () => {
    expect(
      CreateLeadSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        notes: 'x'.repeat(5001),
      }).success,
    ).toBe(false);
  });
});

describe('UpdateLeadSchema additional', () => {
  it('rejects invalid source in update', () => {
    expect(UpdateLeadSchema.safeParse({ source: 'fax' }).success).toBe(false);
  });

  it('accepts phone update', () => {
    expect(UpdateLeadSchema.safeParse({ phone: '555-9999' }).success).toBe(
      true,
    );
  });

  it('accepts null estimatedValue in update', () => {
    expect(UpdateLeadSchema.safeParse({ estimatedValue: null }).success).toBe(
      true,
    );
  });

  it('rejects negative estimatedValue in update', () => {
    expect(UpdateLeadSchema.safeParse({ estimatedValue: -50 }).success).toBe(
      false,
    );
  });

  it('accepts null campaignId in update', () => {
    expect(UpdateLeadSchema.safeParse({ campaignId: null }).success).toBe(true);
  });

  it('rejects email without @ in update', () => {
    expect(UpdateLeadSchema.safeParse({ email: 'noatsign' }).success).toBe(
      false,
    );
  });
});

describe('WithdrawLeadSchema', () => {
  it('accepts an empty body — the reason is optional', () => {
    expect(WithdrawLeadSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    'schedule_no_longer_works',
    'chose_another_provider',
    'no_longer_needed',
    'other',
  ])('accepts %s', (reason) => {
    const parsed = WithdrawLeadSchema.safeParse({ reason });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe(reason);
  });

  it('rejects a reason outside the closed set', () => {
    expect(
      WithdrawLeadSchema.safeParse({ reason: 'changed_mind' }).success,
    ).toBe(false);
    expect(WithdrawLeadSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(WithdrawLeadSchema.safeParse({ reason: 1 }).success).toBe(false);
  });
});
