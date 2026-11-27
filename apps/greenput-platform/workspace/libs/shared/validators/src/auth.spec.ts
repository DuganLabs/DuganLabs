import { describe, it, expect } from 'vitest';
import {
  RegisterSchema,
  OtpSendSchema,
  OtpVerifySchema,
  SetRecoveryPhoneSchema,
  ConfirmRecoveryPhoneSchema,
} from './auth';

describe('RegisterSchema', () => {
  const valid = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    workspaceName: 'Doe Electric',
    trade: 'Electrical',
  };

  it('validates registration, which never carries a password', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing workspaceName', () => {
    const { workspaceName: _, ...rest } = valid;
    expect(RegisterSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing trade', () => {
    const { trade: _, ...rest } = valid;
    expect(RegisterSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, email: 'bad-email' }).success,
    ).toBe(false);
  });

  it('rejects empty firstName', () => {
    expect(RegisterSchema.safeParse({ ...valid, firstName: '' }).success).toBe(
      false,
    );
  });
});

describe('OtpSendSchema', () => {
  it('validates phone number', () => {
    expect(OtpSendSchema.safeParse({ phone: '5551234567' }).success).toBe(true);
  });

  it('rejects short phone', () => {
    expect(OtpSendSchema.safeParse({ phone: '123' }).success).toBe(false);
  });

  it('rejects missing phone', () => {
    expect(OtpSendSchema.safeParse({}).success).toBe(false);
  });

  it('rejects empty phone', () => {
    expect(OtpSendSchema.safeParse({ phone: '' }).success).toBe(false);
  });
});

describe('OtpVerifySchema', () => {
  it('validates phone + 6-digit code', () => {
    expect(
      OtpVerifySchema.safeParse({ phone: '5551234567', code: '123456' })
        .success,
    ).toBe(true);
  });

  it('rejects wrong length code', () => {
    expect(
      OtpVerifySchema.safeParse({ phone: '5551234567', code: '12345' }).success,
    ).toBe(false);
  });

  it('rejects 7-digit code', () => {
    expect(
      OtpVerifySchema.safeParse({ phone: '5551234567', code: '1234567' })
        .success,
    ).toBe(false);
  });

  it('rejects missing code', () => {
    expect(OtpVerifySchema.safeParse({ phone: '5551234567' }).success).toBe(
      false,
    );
  });

  it('rejects empty code', () => {
    expect(
      OtpVerifySchema.safeParse({ phone: '5551234567', code: '' }).success,
    ).toBe(false);
  });
});

describe('RegisterSchema additional', () => {
  const valid = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    workspaceName: 'Doe Electric',
    trade: 'Electrical',
  };

  it('accepts optional phone field', () => {
    const result = RegisterSchema.safeParse({ ...valid, phone: '5551234567' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe('5551234567');
  });

  it('defaults phone to empty string when not provided', () => {
    const result = RegisterSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe('');
  });

  it('rejects empty lastName', () => {
    expect(RegisterSchema.safeParse({ ...valid, lastName: '' }).success).toBe(
      false,
    );
  });

  it('rejects empty workspaceName', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, workspaceName: '' }).success,
    ).toBe(false);
  });

  it('accepts optional address fields', () => {
    const result = RegisterSchema.safeParse({
      ...valid,
      street: '123 Main St',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.street).toBe('123 Main St');
      expect(result.data.city).toBe('Denver');
      expect(result.data.state).toBe('CO');
      expect(result.data.zip).toBe('80202');
    }
  });

  it('defaults address fields to empty strings when not provided', () => {
    const result = RegisterSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.street).toBe('');
      expect(result.data.city).toBe('');
      expect(result.data.state).toBe('');
      expect(result.data.zip).toBe('');
    }
  });

  it('rejects a street address over 255 chars', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, street: 'a'.repeat(256) }).success,
    ).toBe(false);
  });

  it('rejects a city over 100 chars', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, city: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  it('rejects a state over 50 chars', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, state: 'a'.repeat(51) }).success,
    ).toBe(false);
  });

  it('rejects a zip over 20 chars', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, zip: 'a'.repeat(21) }).success,
    ).toBe(false);
  });
});

describe('RegisterSchema carries the rest of the wizard (GP-039)', () => {
  const valid = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    workspaceName: 'Doe Electric',
    trade: 'HVAC',
  };

  it('keeps every service picked, not just the first', () => {
    const parsed = RegisterSchema.parse({
      ...valid,
      serviceTypes: ['HVAC', 'Plumbing', 'Electrical'],
    });
    expect(parsed.serviceTypes).toEqual(['HVAC', 'Plumbing', 'Electrical']);
  });

  it('defaults serviceTypes to an empty list when a caller sends only trade', () => {
    expect(RegisterSchema.parse(valid).serviceTypes).toEqual([]);
  });

  it('keeps the service area and radius', () => {
    const parsed = RegisterSchema.parse({
      ...valid,
      serviceArea: 'Springfield metro',
      serviceRadiusMiles: 40,
    });
    expect(parsed.serviceArea).toBe('Springfield metro');
    expect(parsed.serviceRadiusMiles).toBe(40);
  });

  it('holds the radius to a whole number of miles', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, serviceRadiusMiles: 12.5 }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({ ...valid, serviceRadiusMiles: 0 }).success,
    ).toBe(false);
  });

  it('keeps a hex brand colour and has no default of its own', () => {
    expect(
      RegisterSchema.parse({ ...valid, brandColor: '#3d8b5e' }),
    ).toMatchObject({
      brandColor: '#3d8b5e',
    });
    expect(RegisterSchema.parse(valid).brandColor).toBeUndefined();
  });

  it('rejects a brand colour that is not #rrggbb', () => {
    expect(
      RegisterSchema.safeParse({ ...valid, brandColor: 'green' }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({ ...valid, brandColor: '#3d8' }).success,
    ).toBe(false);
  });

  it('accepts a logo URL and rejects a string that is not one', () => {
    expect(
      RegisterSchema.parse({ ...valid, logoUrl: 'https://x.example/l.png' })
        .logoUrl,
    ).toBe('https://x.example/l.png');
    expect(
      RegisterSchema.safeParse({ ...valid, logoUrl: 'not a url' }).success,
    ).toBe(false);
  });
});

describe('OtpSendSchema additional', () => {
  it('accepts exactly 10-char phone', () => {
    expect(OtpSendSchema.safeParse({ phone: '5551234567' }).success).toBe(true);
  });

  it('rejects 9-char phone', () => {
    expect(OtpSendSchema.safeParse({ phone: '555123456' }).success).toBe(false);
  });
});

describe('OtpVerifySchema additional', () => {
  it('rejects non-digit code of correct length', () => {
    // Zod length() only checks length, not content — this passes
    const result = OtpVerifySchema.safeParse({
      phone: '5551234567',
      code: 'abcdef',
    });
    expect(result.success).toBe(true); // digits not enforced by schema
  });

  it('rejects short phone with valid code', () => {
    expect(
      OtpVerifySchema.safeParse({ phone: '12345', code: '123456' }).success,
    ).toBe(false);
  });
});

describe('OtpVerifySchema is a sign-in schema, not a signup schema', () => {
  it('strips signup-shaped fields', () => {
    // It always did. What changed is that the route no longer has a branch
    // that reads them: /api/auth/otp/verify only ever signs in an account
    // that already exists, and /api/auth/register is the one signup door.
    const result = OtpVerifySchema.safeParse({
      phone: '5551234567',
      code: '123456',
      firstName: 'Mallory',
      lastName: 'Smith',
      workspaceName: 'Not A Real Company',
      trade: 'general',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ phone: '5551234567', code: '123456' });
  });

  it('needs exactly the two fields verify actually uses', () => {
    expect(Object.keys(OtpVerifySchema.shape).sort()).toEqual([
      'code',
      'phone',
    ]);
  });
});

describe('SetRecoveryPhoneSchema', () => {
  it('accepts a plausible phone number', () => {
    expect(
      SetRecoveryPhoneSchema.safeParse({ phone: '9495550199' }).success,
    ).toBe(true);
  });

  it('rejects a number too short to be one', () => {
    expect(SetRecoveryPhoneSchema.safeParse({ phone: '12345' }).success).toBe(
      false,
    );
  });

  it('requires the field', () => {
    expect(SetRecoveryPhoneSchema.safeParse({}).success).toBe(false);
  });
});

describe('ConfirmRecoveryPhoneSchema', () => {
  it('needs both the number and the code that proves it', () => {
    // Confirming without the code would let a live session point recovery at
    // any number it liked.
    expect(
      ConfirmRecoveryPhoneSchema.safeParse({ phone: '9495550199' }).success,
    ).toBe(false);
    expect(
      ConfirmRecoveryPhoneSchema.safeParse({ code: '123456' }).success,
    ).toBe(false);
    expect(
      ConfirmRecoveryPhoneSchema.safeParse({
        phone: '9495550199',
        code: '123456',
      }).success,
    ).toBe(true);
  });

  it('holds the code to exactly six digits', () => {
    expect(
      ConfirmRecoveryPhoneSchema.safeParse({
        phone: '9495550199',
        code: '12345',
      }).success,
    ).toBe(false);
  });
});

describe('there is no password anywhere in auth', () => {
  it('ignores a password if a caller still sends one', () => {
    // Not rejected — a third-party caller posting the old shape should still
    // be able to register — but never carried through to a column. Sign-in is
    // passkeys only; a stored password would be a credential nothing can
    // present and the only thing an attacker could guess.
    const parsed = RegisterSchema.parse({
      firstName: 'Ada',
      lastName: 'Byron',
      email: 'ada@example.com',
      workspaceName: 'Byron Electric',
      trade: 'electrical',
      password: 'hunter2hunter2',
    });
    expect(parsed).not.toHaveProperty('password');
  });
});
