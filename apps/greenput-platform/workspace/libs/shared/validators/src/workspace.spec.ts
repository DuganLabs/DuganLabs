import { describe, it, expect } from 'vitest';
import {
  UpdateWorkspaceSchema,
  InviteUserSchema,
  UpdateUserRoleSchema,
} from './workspace';

describe('UpdateWorkspaceSchema', () => {
  it('validates partial update', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ name: 'Acme Electric' }).success,
    ).toBe(true);
  });

  it('rejects empty update', () => {
    expect(UpdateWorkspaceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ email: 'not-email' }).success,
    ).toBe(false);
  });

  it('accepts valid email update', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ email: 'owner@acme.com' }).success,
    ).toBe(true);
  });

  it('accepts phone update alone', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ phone: '5551234567' }).success,
    ).toBe(true);
  });

  it('accepts trade update alone', () => {
    expect(UpdateWorkspaceSchema.safeParse({ trade: 'Plumbing' }).success).toBe(
      true,
    );
  });
});

describe('UpdateWorkspaceSchema — service area and services (GP-039)', () => {
  it('accepts the area, radius and the whole service list', () => {
    const r = UpdateWorkspaceSchema.safeParse({
      serviceArea: 'Springfield metro',
      serviceRadiusMiles: 40,
      serviceTypes: ['HVAC', 'Plumbing'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.serviceTypes).toEqual(['HVAC', 'Plumbing']);
    }
  });

  it('lets null clear the area and the radius', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({
        serviceArea: null,
        serviceRadiusMiles: null,
      }).success,
    ).toBe(true);
  });

  it('holds the radius to a whole number of miles', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ serviceRadiusMiles: 12.5 }).success,
    ).toBe(false);
    expect(
      UpdateWorkspaceSchema.safeParse({ serviceRadiusMiles: '40' }).success,
    ).toBe(false);
  });
});

describe('InviteUserSchema', () => {
  it('validates a complete invitation', () => {
    const result = InviteUserSchema.safeParse({
      firstName: 'Mike',
      lastName: 'Tech',
      email: 'mike@acme.com',
      role: 'tech',
      password: 'securepass123',
    });
    expect(result.success).toBe(true);
  });

  it('defaults role to tech', () => {
    const result = InviteUserSchema.safeParse({
      firstName: 'Mike',
      lastName: 'Tech',
      email: 'mike@acme.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('tech');
    }
  });

  it('rejects invalid role', () => {
    expect(
      InviteUserSchema.safeParse({
        firstName: 'Mike',
        lastName: 'Tech',
        email: 'mike@acme.com',
        role: 'superadmin',
      }).success,
    ).toBe(false);
  });

  it('rejects short password', () => {
    expect(
      InviteUserSchema.safeParse({
        firstName: 'Mike',
        lastName: 'Tech',
        email: 'mike@acme.com',
        password: '123',
      }).success,
    ).toBe(false);
  });

  it('rejects missing firstName', () => {
    expect(
      InviteUserSchema.safeParse({ lastName: 'Tech', email: 'mike@acme.com' })
        .success,
    ).toBe(false);
  });

  it('rejects missing email', () => {
    expect(
      InviteUserSchema.safeParse({ firstName: 'Mike', lastName: 'Tech' })
        .success,
    ).toBe(false);
  });

  it('accepts all valid roles', () => {
    const roles = ['owner', 'admin', 'tech', 'office'] as const;
    for (const role of roles) {
      const result = InviteUserSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        role,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('UpdateUserRoleSchema', () => {
  it('validates valid role', () => {
    expect(UpdateUserRoleSchema.safeParse({ role: 'admin' }).success).toBe(
      true,
    );
  });

  it('rejects invalid role', () => {
    expect(UpdateUserRoleSchema.safeParse({ role: 'ceo' }).success).toBe(false);
  });

  it('accepts all valid roles', () => {
    const roles = ['owner', 'admin', 'tech', 'office'] as const;
    for (const role of roles) {
      expect(UpdateUserRoleSchema.safeParse({ role }).success).toBe(true);
    }
  });

  it('rejects missing role', () => {
    expect(UpdateUserRoleSchema.safeParse({}).success).toBe(false);
  });

  it('rejects empty string role', () => {
    expect(UpdateUserRoleSchema.safeParse({ role: '' }).success).toBe(false);
  });
});

describe('UpdateWorkspaceSchema additional', () => {
  it('accepts address fields update', () => {
    const result = UpdateWorkspaceSchema.safeParse({
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null licenseNumber', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ licenseNumber: null }).success,
    ).toBe(true);
  });

  it('accepts null logoUrl', () => {
    expect(UpdateWorkspaceSchema.safeParse({ logoUrl: null }).success).toBe(
      true,
    );
  });

  it('rejects invalid logoUrl', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ logoUrl: 'not-a-url' }).success,
    ).toBe(false);
  });

  it('rejects name over 200 chars', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ name: 'A'.repeat(201) }).success,
    ).toBe(false);
  });

  it('accepts name at exactly 200 chars', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ name: 'A'.repeat(200) }).success,
    ).toBe(true);
  });
});

describe('InviteUserSchema additional', () => {
  it('accepts password at exactly 8 chars', () => {
    const result = InviteUserSchema.safeParse({
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      password: '12345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email format', () => {
    expect(
      InviteUserSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });

  it('rejects firstName over 100 chars', () => {
    expect(
      InviteUserSchema.safeParse({
        firstName: 'A'.repeat(101),
        lastName: 'B',
        email: 'a@b.com',
      }).success,
    ).toBe(false);
  });
});
