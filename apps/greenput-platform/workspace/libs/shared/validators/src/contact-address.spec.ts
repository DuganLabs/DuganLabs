// ─────────────────────────────────────────────────────────────
// The nested→flat fold, on every schema that carries it.
//
// The end-to-end proof for leads and customers is in
// apps/platform/src/contract/reads-the-real-api.spec.ts, which fills the real
// panel, takes the payload the client built, and drives it through the real
// router into a real database. That is the test that would have caught the
// original defect and a schema unit test would not.
//
// This file covers what that one cannot reach: the job and update schemas.
// The New job panel still demands hand-typed UUIDs for opportunity and
// customer (GP-015), so it cannot be driven from the DOM yet, and no edit form
// exists anywhere in the product to exercise the Update schemas (GP-003).
// Until those land this is the only coverage they have — so when GP-015 or
// GP-003 ships, move these up to the contract spec rather than leaving them
// here.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { CreateCustomerSchema, UpdateCustomerSchema } from './customer';
import { CreateJobSchema, UpdateJobSchema } from './job';
import { CreateLeadSchema, UpdateLeadSchema } from './lead';

const JOB_IDS = {
  opportunityId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
};

describe('nested contact and address on create', () => {
  it('folds a lead’s contact object onto the columns the handler binds', () => {
    const out = CreateLeadSchema.parse({
      firstName: 'Priya',
      lastName: 'Raman',
      contact: {
        email: 'priya@example.com',
        phone: '5125550190',
        preferredContact: 'email',
      },
    });
    expect(out.email).toBe('priya@example.com');
    expect(out.phone).toBe('5125550190');
    expect(out.preferredContact).toBe('email');
    expect(out).not.toHaveProperty('contact');
  });

  it('folds a customer’s contact AND address', () => {
    const out = CreateCustomerSchema.parse({
      firstName: 'Sam',
      lastName: 'Okafor',
      contact: { email: 'sam@example.com', phone: '5125550191' },
      address: {
        street: '9 Birch Ave',
        city: 'Rivertown',
        state: 'TX',
        zip: '78703',
      },
    });
    expect(out).toMatchObject({
      email: 'sam@example.com',
      phone: '5125550191',
      street: '9 Birch Ave',
      city: 'Rivertown',
      state: 'TX',
      zip: '78703',
    });
  });

  it('folds a job’s address — the line the dashboard run sheet prints', () => {
    const out = CreateJobSchema.parse({
      title: 'Panel upgrade',
      ...JOB_IDS,
      address: {
        street: '9 Birch Ave',
        city: 'Rivertown',
        state: 'TX',
        zip: '78703',
      },
    });
    expect(out).toMatchObject({
      street: '9 Birch Ave',
      city: 'Rivertown',
      state: 'TX',
      zip: '78703',
    });
  });

  it('still accepts the flat shape, which API-key callers may already send', () => {
    const out = CreateLeadSchema.parse({
      firstName: 'Flat',
      lastName: 'Caller',
      email: 'flat@example.com',
      phone: '5125550192',
    });
    expect(out.email).toBe('flat@example.com');
    expect(out.phone).toBe('5125550192');
  });

  it('lets nested win when a caller sends both', () => {
    const out = CreateLeadSchema.parse({
      firstName: 'Both',
      lastName: 'Shapes',
      email: 'flat@example.com',
      contact: { email: 'nested@example.com' },
    });
    expect(out.email).toBe('nested@example.com');
  });

  it('does not let a partial contact blank a sibling sent flat', () => {
    const out = CreateLeadSchema.parse({
      firstName: 'Half',
      lastName: 'Nested',
      phone: '5125550193',
      contact: { email: 'only-email@example.com' },
    });
    expect(out.email).toBe('only-email@example.com');
    expect(out.phone).toBe('5125550193');
  });

  it('leaves the defaults alone when neither shape carries contact', () => {
    const out = CreateLeadSchema.parse({
      firstName: 'No',
      lastName: 'Contact',
    });
    expect(out.email).toBe('');
    expect(out.phone).toBe('');
    expect(out.preferredContact).toBe('phone');
  });
});

describe('nested contact and address on update', () => {
  it('folds a PATCH that carries only a nested phone', () => {
    const out = UpdateLeadSchema.parse({ contact: { phone: '5125550194' } });
    expect(out).toEqual({ phone: '5125550194' });
  });

  it('writes no key for a field the PATCH did not mention', () => {
    const out = UpdateCustomerSchema.parse({
      address: { city: 'Rivertown' },
    });
    // Absence means "leave it alone" on a PATCH. Folding `undefined` onto
    // street/state/zip here would be the same data loss in a new place.
    expect(out).toEqual({ city: 'Rivertown' });
    expect(out).not.toHaveProperty('street');
  });

  it('folds a job PATCH carrying only a nested address', () => {
    const out = UpdateJobSchema.parse({ address: { street: '11 Cedar Rd' } });
    expect(out).toEqual({ street: '11 Cedar Rd' });
  });

  it('still rejects a PATCH with nothing in it', () => {
    expect(UpdateLeadSchema.safeParse({}).success).toBe(false);
  });

  it('counts a nested-only PATCH as non-empty', () => {
    // The emptiness check runs AFTER the fold, so `{ contact: { phone } }`
    // must not read as "no fields provided".
    expect(
      UpdateLeadSchema.safeParse({ contact: { phone: '5125550195' } }).success,
    ).toBe(true);
  });
});
