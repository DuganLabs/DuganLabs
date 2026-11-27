import { describe, it, expect } from 'vitest';
import { CreateVehicleSchema, UpdateVehicleSchema } from './vehicle';

describe('CreateVehicleSchema', () => {
  it('accepts a minimal valid vehicle', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Service Van 1' });
    expect(result.success).toBe(true);
  });

  it('accepts a full vehicle', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Service Van 1',
      make: 'Ford',
      model: 'Transit',
      year: 2022,
      licensePlate: 'ABC1234',
      vin: '1FTBF2A60NKA12345',
      status: 'active',
      mileage: 15000,
      notes: 'Main service vehicle',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateVehicleSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      status: 'broken',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative mileage', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      mileage: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects year before 1900', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Van', year: 1899 });
    expect(result.success).toBe(false);
  });

  it('defaults status to active', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Van' });
    expect(result.success && result.data.status).toBe('active');
  });

  it('defaults mileage to 0', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Van' });
    expect(result.success && result.data.mileage).toBe(0);
  });

  it('accepts maintenance status', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      status: 'maintenance',
    });
    expect(result.success).toBe(true);
  });

  it('accepts inactive status', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      status: 'inactive',
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateVehicleSchema', () => {
  it('accepts partial update', () => {
    const result = UpdateVehicleSchema.safeParse({ mileage: 20000 });
    expect(result.success).toBe(true);
  });

  it('accepts status update', () => {
    const result = UpdateVehicleSchema.safeParse({ status: 'maintenance' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = UpdateVehicleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = UpdateVehicleSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('accepts nullable license plate', () => {
    const result = UpdateVehicleSchema.safeParse({ licensePlate: null });
    expect(result.success).toBe(true);
  });

  it('accepts nullable vin', () => {
    const result = UpdateVehicleSchema.safeParse({ vin: null });
    expect(result.success).toBe(true);
  });

  it('accepts negative mileage rejection', () => {
    const result = UpdateVehicleSchema.safeParse({ mileage: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid statuses in update', () => {
    const statuses = ['active', 'maintenance', 'inactive'] as const;
    for (const status of statuses) {
      expect(UpdateVehicleSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects invalid status in update', () => {
    expect(UpdateVehicleSchema.safeParse({ status: 'broken' }).success).toBe(
      false,
    );
  });
});

describe('CreateVehicleSchema additional', () => {
  it('accepts current year as valid', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      year: new Date().getFullYear(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects VIN over 17 chars', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      vin: 'A'.repeat(18),
    });
    expect(result.success).toBe(false);
  });

  it('accepts VIN exactly 17 chars', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      vin: 'A'.repeat(17),
    });
    expect(result.success).toBe(true);
  });

  it('rejects name over 255 chars', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'A'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('rejects license plate over 20 chars', () => {
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      licensePlate: 'A'.repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it('defaults make to empty string', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Van' });
    expect(result.success && result.data.make).toBe('');
  });

  it('defaults model to empty string', () => {
    const result = CreateVehicleSchema.safeParse({ name: 'Van' });
    expect(result.success && result.data.model).toBe('');
  });
});

describe('UpdateVehicleSchema additional', () => {
  it('accepts name with max 255 chars', () => {
    const result = UpdateVehicleSchema.safeParse({ name: 'A'.repeat(255) });
    expect(result.success).toBe(true);
  });

  it('rejects name over 255 chars', () => {
    const result = UpdateVehicleSchema.safeParse({ name: 'A'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('accepts zero mileage', () => {
    const result = UpdateVehicleSchema.safeParse({ mileage: 0 });
    expect(result.success).toBe(true);
  });
});
