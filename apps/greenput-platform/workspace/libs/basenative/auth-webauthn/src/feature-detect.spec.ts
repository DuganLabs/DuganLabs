import { describe, it, expect, afterEach } from 'vitest';
import {
  isConditionalMediationAvailable,
  isWebAuthnAvailable,
} from './feature-detect.js';

const originalPKC = (globalThis as { PublicKeyCredential?: unknown })
  .PublicKeyCredential;

afterEach(() => {
  if (originalPKC === undefined) {
    delete (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
  } else {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential =
      originalPKC;
  }
});

describe('isWebAuthnAvailable', () => {
  it('returns false when PublicKeyCredential is undefined', () => {
    delete (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
    expect(isWebAuthnAvailable()).toBe(false);
  });

  it('returns true when PublicKeyCredential is defined', () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential =
      function PublicKeyCredentialStub() {
        /* stub */
      };
    expect(isWebAuthnAvailable()).toBe(true);
  });
});

describe('isConditionalMediationAvailable', () => {
  it('returns false when WebAuthn is unavailable', async () => {
    delete (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
    await expect(isConditionalMediationAvailable()).resolves.toBe(false);
  });

  it('returns false when isConditionalMediationAvailable is missing', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};
    await expect(isConditionalMediationAvailable()).resolves.toBe(false);
  });

  it('returns true when supported and the call resolves true', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      isConditionalMediationAvailable: async () => true,
    };
    await expect(isConditionalMediationAvailable()).resolves.toBe(true);
  });

  it('swallows errors and returns false', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
      isConditionalMediationAvailable: async () => {
        throw new Error('boom');
      },
    };
    await expect(isConditionalMediationAvailable()).resolves.toBe(false);
  });
});
