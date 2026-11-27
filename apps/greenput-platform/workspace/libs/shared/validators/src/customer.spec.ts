import { describe, it, expect } from 'vitest';
import { CreateCustomerSchema, UpdateCustomerSchema } from './customer';

describe('CreateCustomerSchema', () => {
  it('validates with required fields and defaults preferredContact to phone', () => {
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Johnson',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferredContact).toBe('phone');
    }
  });

  it('validates a complete customer', () => {
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Bob',
      lastName: 'Williams',
      company: 'Williams LLC',
      email: 'bob@williams.com',
      phone: '555-0200',
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      consentMethod: 'form',
      consentGivenAt: '2026-01-15T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing firstName', () => {
    expect(CreateCustomerSchema.safeParse({ lastName: 'Doe' }).success).toBe(
      false,
    );
  });

  it('rejects empty firstName', () => {
    expect(
      CreateCustomerSchema.safeParse({ firstName: '', lastName: 'Doe' })
        .success,
    ).toBe(false);
  });

  it('rejects missing lastName', () => {
    expect(CreateCustomerSchema.safeParse({ firstName: 'Jane' }).success).toBe(
      false,
    );
  });

  it('rejects invalid email format', () => {
    expect(
      CreateCustomerSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });

  it('accepts all valid preferredContact values', () => {
    const contacts = ['email', 'phone', 'text'];
    for (const preferredContact of contacts) {
      expect(
        CreateCustomerSchema.safeParse({
          firstName: 'Alice',
          lastName: 'Smith',
          preferredContact,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects invalid preferredContact', () => {
    expect(
      CreateCustomerSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        preferredContact: 'fax',
      }).success,
    ).toBe(false);
  });

  it('accepts all valid consentMethod values', () => {
    const methods = ['form', 'verbal', 'email'];
    for (const consentMethod of methods) {
      expect(
        CreateCustomerSchema.safeParse({
          firstName: 'Alice',
          lastName: 'Smith',
          consentMethod,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts null consentMethod', () => {
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Smith',
      consentMethod: null,
    });
    expect(result.success).toBe(true);
  });

  it('defaults notes, company, email, phone, address fields', () => {
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('');
      expect(result.data.company).toBeNull();
      expect(result.data.email).toBe('');
      expect(result.data.phone).toBe('');
      expect(result.data.city).toBe('');
      expect(result.data.consentMethod).toBeNull();
    }
  });
});

describe('UpdateCustomerSchema', () => {
  it('validates partial update with company', () => {
    expect(UpdateCustomerSchema.safeParse({ company: 'New Co' }).success).toBe(
      true,
    );
  });

  it('validates partial update with email', () => {
    expect(
      UpdateCustomerSchema.safeParse({ email: 'new@email.com' }).success,
    ).toBe(true);
  });

  it('rejects empty update', () => {
    expect(UpdateCustomerSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid email in update', () => {
    expect(UpdateCustomerSchema.safeParse({ email: 'bad-email' }).success).toBe(
      false,
    );
  });

  it('rejects invalid consentMethod in update', () => {
    expect(
      UpdateCustomerSchema.safeParse({ consentMethod: 'magic' }).success,
    ).toBe(false);
  });

  it('accepts null consentMethod in update', () => {
    expect(
      UpdateCustomerSchema.safeParse({ consentMethod: null }).success,
    ).toBe(true);
  });

  it('accepts phone update', () => {
    expect(UpdateCustomerSchema.safeParse({ phone: '555-1234' }).success).toBe(
      true,
    );
  });

  it('accepts null company in update', () => {
    expect(UpdateCustomerSchema.safeParse({ company: null }).success).toBe(
      true,
    );
  });

  it('rejects firstName exceeding 100 chars in update', () => {
    expect(
      UpdateCustomerSchema.safeParse({ firstName: 'A'.repeat(101) }).success,
    ).toBe(false);
  });
});

describe('CreateCustomerSchema additional', () => {
  it('rejects firstName exceeding max length (101 chars)', () => {
    expect(
      CreateCustomerSchema.safeParse({
        firstName: 'A'.repeat(101),
        lastName: 'Smith',
      }).success,
    ).toBe(false);
  });

  it('accepts firstName at max length (100 chars)', () => {
    expect(
      CreateCustomerSchema.safeParse({
        firstName: 'A'.repeat(100),
        lastName: 'Smith',
      }).success,
    ).toBe(true);
  });

  it('accepts valid consentGivenAt datetime', () => {
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Alice',
      lastName: 'Smith',
      consentGivenAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consentGivenAt).toBe('2026-01-01T00:00:00.000Z');
    }
  });

  it('rejects consentGivenAt with date-only format', () => {
    expect(
      CreateCustomerSchema.safeParse({
        firstName: 'Alice',
        lastName: 'Smith',
        consentGivenAt: '2026-01-01',
      }).success,
    ).toBe(false);
  });
});
