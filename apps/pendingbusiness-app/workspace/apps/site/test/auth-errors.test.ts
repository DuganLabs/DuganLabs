import { describe, it, expect } from 'vitest';
import { describeAuthError } from '../src/lib/auth-errors.js';

describe('describeAuthError', () => {
  it('maps user-not-found to guidance about usernameless sign-in', () => {
    const text = describeAuthError(new Error('user-not-found'), 'Sign-in failed.');
    expect(text).toMatch(/No passkey is enrolled for that handle/);
    expect(text).not.toContain('user-not-found');
  });

  it('maps enrollment-closed to invitation-only copy', () => {
    expect(describeAuthError(new Error('enrollment-closed'), 'x')).toMatch(/invitation-only/);
  });

  it('rewrites the WebAuthn "previously registered" message', () => {
    const err = new DOMException(
      'The authenticator was previously registered',
      'InvalidStateError',
    );
    expect(describeAuthError(err, 'Enrollment failed.')).toBe(
      'This device already has a passkey for this account.',
    );
  });

  it('turns request-failed-<status> into a readable HTTP error', () => {
    expect(describeAuthError(new Error('request-failed-503'), 'x')).toBe(
      'The server returned an error (HTTP 503). Try again.',
    );
  });

  it('describes a cancelled OS prompt', () => {
    const err = new DOMException(
      'The operation either timed out or was not allowed',
      'NotAllowedError',
    );
    expect(describeAuthError(err, 'x')).toMatch(/cancelled or timed out/);
  });

  it('falls back to the caller-supplied message for unknown errors', () => {
    expect(describeAuthError(new Error('something-weird'), 'Sign-in failed.')).toBe(
      'Sign-in failed.',
    );
    expect(describeAuthError('not an error', 'Sign-in failed.')).toBe('Sign-in failed.');
  });
});
