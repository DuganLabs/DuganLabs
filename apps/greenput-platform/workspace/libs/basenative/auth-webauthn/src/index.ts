export {
  createAuthStore,
  type AuthStore,
  type AuthStoreOptions,
  type PasskeyAttemptOptions,
} from './auth-store.js';
export {
  createWebAuthnClient,
  type WebAuthnClient,
  type WebAuthnClientOptions,
} from './webauthn-client.js';
export {
  isWebAuthnAvailable,
  isConditionalMediationAvailable,
} from './feature-detect.js';
export { classifyAuthError, type AuthErrorKind } from './error-kind.js';
export {
  withTimeout,
  PasskeyTimeoutError,
  PASSKEY_PROMPT_TIMEOUT_MS,
} from './prompt-timeout.js';
export type {
  AuthUser,
  SimpleWebAuthnBrowser,
  SimpleWebAuthnLoader,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from './types.js';
