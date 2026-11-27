import { z } from 'zod';
import { HexColorSchema } from './branding';

// There is no LoginSchema. Sign-in is passkeys only — `POST /api/auth/login`
// was removed along with the last password path (see apps/api/src/routes/auth.ts).
// The way back in without a passkey is `/api/auth/otp/*`.

export const RegisterSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  workspaceName: z.string().min(1).max(200),
  trade: z.string().min(1).max(100),
  phone: z.string().max(20).optional().default(''),
  // Business address, collected on the onboarding wizard's account step.
  // Optional (same convention as elsewhere — see customer.ts/job.ts/lead.ts
  // and UpdateWorkspaceSchema) since a contractor can add it later from
  // Settings; the workspaces table defaults each column to ''.
  street: z.string().max(255).optional().default(''),
  city: z.string().max(100).optional().default(''),
  state: z.string().max(50).optional().default(''),
  zip: z.string().max(20).optional().default(''),
  // The rest of what the wizard asks (GP-039). This schema is a plain
  // z.object, so a key it does not name is a key Zod strips — which is how
  // six onboarding answers were collected, reviewed and discarded. Every
  // field below is optional: a caller that sends only `trade` still
  // registers, and apps/api fills in what is missing.
  //
  // `serviceTypes` is the whole "pick all that apply" selection; `trade` is
  // its first entry, kept for the readers that still want one string.
  serviceTypes: z
    .array(z.string().min(1).max(100))
    .max(50)
    .optional()
    .default([]),
  serviceArea: z.string().max(200).optional().default(''),
  serviceRadiusMiles: z.number().int().min(1).max(500).optional(),
  // Written to the `branding` row, not to `workspaces`: `branding` is the
  // table the micro-site and Settings → Branding already read. No default
  // here — the one default lives in libs/shared/models
  // (DEFAULT_BRAND_PRIMARY_COLOR) and apps/api applies it.
  brandColor: HexColorSchema.optional(),
  logoUrl: z.string().url().max(500).optional(),
});

// ── One-time-code account recovery ───────────────────────────────────────
//
// These four schemas describe a *recovery* channel, not a signup channel.
// `/api/auth/otp/verify` used to fall through to creating a workspace and a
// user when the phone matched nothing, and `OtpVerifySchema` declared only
// {phone, code} — so Zod stripped the firstName/lastName/workspaceName/trade
// that branch read, and it was unreachable in every case. That branch is gone
// (see apps/api/src/routes/otp.ts); signup has exactly one door, `/register`,
// which writes its three rows in a single D1 batch. So this schema is now
// correct rather than merely consistent: {phone, code} really is everything
// verify needs.
export const OtpSendSchema = z.object({
  phone: z.string().min(10).max(20),
});

export const OtpVerifySchema = z.object({
  phone: z.string().min(10).max(20),
  code: z.string().length(6),
});

/** Start binding a personal recovery number to the signed-in user. */
export const SetRecoveryPhoneSchema = z.object({
  phone: z.string().min(10).max(20),
});

/** Finish binding it, proving possession of the number first. */
export const ConfirmRecoveryPhoneSchema = z.object({
  phone: z.string().min(10).max(20),
  code: z.string().length(6),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type OtpSendInput = z.infer<typeof OtpSendSchema>;
export type OtpVerifyInput = z.infer<typeof OtpVerifySchema>;
export type SetRecoveryPhoneInput = z.infer<typeof SetRecoveryPhoneSchema>;
export type ConfirmRecoveryPhoneInput = z.infer<
  typeof ConfirmRecoveryPhoneSchema
>;
