import { describe, it, expect } from 'vitest';
import {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  AdjustInventorySchema,
} from './inventory';

describe('CreateInventoryItemSchema', () => {
  it('accepts a minimal valid item', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'Circuit Breaker',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full item', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'Circuit Breaker 20A',
      sku: 'CBK-20A',
      description: 'Standard 20-amp breaker',
      category: 'electrical',
      quantity: 50,
      minQuantity: 5,
      unitCost: 1500,
      unitPrice: 2500,
      supplier: 'Acme Electric',
      location: 'Warehouse A, Shelf 3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateInventoryItemSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'Part',
      quantity: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative unit cost', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'Part',
      unitCost: -100,
    });
    expect(result.success).toBe(false);
  });

  it('defaults quantity to 0', () => {
    const result = CreateInventoryItemSchema.safeParse({ name: 'Part' });
    expect(result.success && result.data.quantity).toBe(0);
  });

  it('defaults category to general', () => {
    const result = CreateInventoryItemSchema.safeParse({ name: 'Part' });
    expect(result.success && result.data.category).toBe('general');
  });
});

describe('UpdateInventoryItemSchema', () => {
  it('accepts partial update', () => {
    const result = UpdateInventoryItemSchema.safeParse({ quantity: 25 });
    expect(result.success).toBe(true);
  });

  it('accepts name update', () => {
    const result = UpdateInventoryItemSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = UpdateInventoryItemSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = UpdateInventoryItemSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});

describe('AdjustInventorySchema', () => {
  it('accepts a purchase adjustment', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'purchase',
      quantity: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a usage adjustment with notes', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'usage',
      quantity: 3,
      notes: 'Used on job #123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts adjustment with jobId', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'usage',
      quantity: 2,
      jobId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid transaction type', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'unknown',
      quantity: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero quantity', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'purchase',
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'purchase',
      quantity: -5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = AdjustInventorySchema.safeParse({ quantity: 5 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid transaction types', () => {
    for (const type of ['purchase', 'usage', 'adjustment', 'return']) {
      expect(
        AdjustInventorySchema.safeParse({ type, quantity: 1 }).success,
      ).toBe(true);
    }
  });

  it('rejects missing quantity', () => {
    const result = AdjustInventorySchema.safeParse({ type: 'purchase' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer quantity', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'purchase',
      quantity: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts unitCost field', () => {
    const result = AdjustInventorySchema.safeParse({
      type: 'purchase',
      quantity: 10,
      unitCost: 500,
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateInventoryItemSchema additional', () => {
  it('rejects name longer than 255 chars', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('defaults unitCost to 0', () => {
    const result = CreateInventoryItemSchema.safeParse({ name: 'Widget' });
    expect(result.success && result.data.unitCost).toBe(0);
  });

  it('defaults minQuantity to 0', () => {
    const result = CreateInventoryItemSchema.safeParse({ name: 'Widget' });
    expect(result.success && result.data.minQuantity).toBe(0);
  });

  it('accepts zero unit cost', () => {
    const result = CreateInventoryItemSchema.safeParse({
      name: 'Widget',
      unitCost: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateInventoryItemSchema additional', () => {
  it('rejects negative unitCost', () => {
    const result = UpdateInventoryItemSchema.safeParse({ unitCost: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts zero quantity', () => {
    const result = UpdateInventoryItemSchema.safeParse({ quantity: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts sku as null', () => {
    const result = UpdateInventoryItemSchema.safeParse({ sku: null });
    expect(result.success).toBe(true);
  });
});
