import { describe, expect, it } from 'vitest';
import {
  CreateChangeOrderSchema,
  DecideChangeOrderSchema,
} from './change-order';

const JOB = '00000000-0000-4000-8000-0000000000c6';
const EST = '00000000-0000-4000-8000-0000000000d1';
const LINE = { description: 'Subpanel', quantity: 1, unitPrice: 42000 };

describe('CreateChangeOrderSchema', () => {
  it('takes a job change with defaults filled', () => {
    const r = CreateChangeOrderSchema.parse({
      jobId: JOB,
      title: 'Subpanel',
      lineItems: [LINE],
    });
    expect(r).toMatchObject({ jobId: JOB, reason: '' });
    expect(r.lineItems[0]).toMatchObject({ type: 'labor', unitPrice: 42000 });
  });

  it('takes a credit (negative cents)', () => {
    const r = CreateChangeOrderSchema.safeParse({
      estimateId: EST,
      title: 'Credit',
      lineItems: [{ ...LINE, unitPrice: -2500 }],
    });
    expect(r.success).toBe(true);
  });

  it('needs exactly one parent', () => {
    expect(
      CreateChangeOrderSchema.safeParse({ title: 'x', lineItems: [LINE] })
        .success,
    ).toBe(false);
    expect(
      CreateChangeOrderSchema.safeParse({
        jobId: JOB,
        estimateId: EST,
        title: 'x',
        lineItems: [LINE],
      }).success,
    ).toBe(false);
  });

  it('needs at least one line, and whole cents', () => {
    expect(
      CreateChangeOrderSchema.safeParse({
        jobId: JOB,
        title: 'x',
        lineItems: [],
      }).success,
    ).toBe(false);
    expect(
      CreateChangeOrderSchema.safeParse({
        jobId: JOB,
        title: 'x',
        lineItems: [{ ...LINE, unitPrice: 12.5 }],
      }).success,
    ).toBe(false);
  });
});

describe('DecideChangeOrderSchema', () => {
  it('note is optional and bounded', () => {
    expect(DecideChangeOrderSchema.parse({})).toEqual({ note: '' });
    expect(
      DecideChangeOrderSchema.safeParse({ note: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
});
