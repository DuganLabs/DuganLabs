/**
 * Returns true when WebAuthn is available in the current environment.
 * Safe to call on the server — always returns false there.
 */
export function isWebAuthnAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.PublicKeyCredential !== 'undefined';
}

/**
 * Returns true when the browser supports conditional mediation (passkeys
 * appearing in the autofill dropdown alongside saved passwords).
 */
export async function isConditionalMediationAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  const PKC = window.PublicKeyCredential as typeof PublicKeyCredential & {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  if (typeof PKC.isConditionalMediationAvailable !== 'function') return false;
  try {
    return await PKC.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}
