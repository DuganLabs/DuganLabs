import type { ApiClient } from '@basenative/fetch';
import type {
  AuthUser,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  SimpleWebAuthnBrowser,
  SimpleWebAuthnLoader,
} from './types.js';

export interface WebAuthnClientOptions {
  readonly api: ApiClient;
  readonly loadSimpleWebAuthn?: SimpleWebAuthnLoader;
}

export interface WebAuthnClient<TUser = AuthUser> {
  authenticate(): Promise<TUser>;
  authenticateConditional(): Promise<TUser>;
  abortConditional(): void;
  register(): Promise<void>;
}

const defaultLoader: SimpleWebAuthnLoader = () =>
  import('@simplewebauthn/browser') as Promise<SimpleWebAuthnBrowser>;

interface OptionsEnvelope<T> {
  data: T;
}

interface VerifyEnvelope<TUser> {
  data: { user: TUser };
}

/**
 * Low-level passkey client. Owns the four-step option/verify dance against
 * the GreenPut Worker API and lazily loads `@simplewebauthn/browser` on
 * demand so it never bloats the initial bundle.
 */
export function createWebAuthnClient<TUser = AuthUser>(
  options: WebAuthnClientOptions,
): WebAuthnClient<TUser> {
  const loader = options.loadSimpleWebAuthn ?? defaultLoader;
  let conditionalAbort: AbortController | null = null;

  function abortConditional(): void {
    if (conditionalAbort) {
      conditionalAbort.abort();
      conditionalAbort = null;
    }
  }

  async function fetchAuthOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const res = await options.api.post<
      OptionsEnvelope<PublicKeyCredentialRequestOptionsJSON>
    >('/api/auth/webauthn/login/options', {});
    return res.data;
  }

  async function fetchRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const res = await options.api.post<
      OptionsEnvelope<PublicKeyCredentialCreationOptionsJSON>
    >('/api/auth/webauthn/register/options', {});
    return res.data;
  }

  async function verifyAuth(
    payload: AuthenticationResponseJSON,
  ): Promise<TUser> {
    const res = await options.api.post<VerifyEnvelope<TUser>>(
      '/api/auth/webauthn/login/verify',
      payload,
    );
    return res.data.user;
  }

  async function verifyRegister(
    payload: RegistrationResponseJSON,
  ): Promise<void> {
    await options.api.post('/api/auth/webauthn/register/verify', payload);
  }

  async function authenticate(): Promise<TUser> {
    abortConditional();
    const optionsJSON = await fetchAuthOptions();
    const browser = await loader();
    const response = await browser.startAuthentication({ optionsJSON });
    return verifyAuth(response);
  }

  async function authenticateConditional(): Promise<TUser> {
    abortConditional();
    conditionalAbort = new AbortController();
    const optionsJSON = await fetchAuthOptions();
    const browser = await loader();
    const response = await browser.startAuthentication({
      optionsJSON,
      useBrowserAutofill: true,
    });
    conditionalAbort = null;
    return verifyAuth(response);
  }

  async function register(): Promise<void> {
    const optionsJSON = await fetchRegisterOptions();
    const browser = await loader();
    const response = await browser.startRegistration({ optionsJSON });
    await verifyRegister(response);
  }

  return {
    authenticate,
    authenticateConditional,
    abortConditional,
    register,
  };
}
