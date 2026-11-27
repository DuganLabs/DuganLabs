import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '@basenative/fetch';
import { createWebAuthnClient } from './webauthn-client.js';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  SimpleWebAuthnBrowser,
} from './types.js';

const sampleAuthOptions: PublicKeyCredentialRequestOptionsJSON = {
  challenge: 'challenge-bytes',
  rpId: 'app.greenput.com',
};

const sampleRegOptions: PublicKeyCredentialCreationOptionsJSON = {
  challenge: 'challenge-bytes',
  rp: { id: 'app.greenput.com', name: 'GreenPut' },
  user: { id: 'u1', name: 'jane', displayName: 'Jane' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
};

const sampleAuthResponse = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'x',
    authenticatorData: 'y',
    signature: 'z',
    userHandle: 'u',
  },
  clientExtensionResults: {},
} as unknown as AuthenticationResponseJSON;

const sampleRegResponse = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'x',
    attestationObject: 'y',
  },
  clientExtensionResults: {},
} as unknown as RegistrationResponseJSON;

const user = {
  id: 'user-1',
  email: 'jane@greenput.com',
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'owner',
  workspaceId: 'ws-1',
};

function makeApi(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(
    async (input: Request | string | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      const matched = Object.entries(routes).find(([path]) =>
        url.endsWith(path),
      );
      if (!matched) return new Response('not found', { status: 404 });
      return matched[1]();
    },
  );
  return {
    api: createApiClient({ baseUrl: 'https://api.test', fetch: fetchImpl }),
    fetchImpl,
    calls,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('createWebAuthnClient', () => {
  it('runs the auth options/verify dance', async () => {
    const startAuthentication = vi.fn(async () => sampleAuthResponse);
    const startRegistration = vi.fn();

    const { api, calls } = makeApi({
      '/api/auth/webauthn/login/options': () =>
        jsonResponse({ data: sampleAuthOptions }),
      '/api/auth/webauthn/login/verify': () => jsonResponse({ data: { user } }),
    });

    const client = createWebAuthnClient<typeof user>({
      api,
      loadSimpleWebAuthn: async (): Promise<SimpleWebAuthnBrowser> => ({
        startAuthentication,
        startRegistration,
      }),
    });

    const result = await client.authenticate();

    expect(result).toEqual(user);
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: sampleAuthOptions,
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/api/auth/webauthn/login/options',
      'https://api.test/api/auth/webauthn/login/verify',
    ]);
  });

  it('uses conditional mediation when authenticateConditional is called', async () => {
    const startAuthentication = vi.fn(async () => sampleAuthResponse);

    const { api } = makeApi({
      '/api/auth/webauthn/login/options': () =>
        jsonResponse({ data: sampleAuthOptions }),
      '/api/auth/webauthn/login/verify': () => jsonResponse({ data: { user } }),
    });

    const client = createWebAuthnClient<typeof user>({
      api,
      loadSimpleWebAuthn: async () => ({
        startAuthentication,
        startRegistration: vi.fn(),
      }),
    });

    await client.authenticateConditional();
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: sampleAuthOptions,
      useBrowserAutofill: true,
    });
  });

  it('register() POSTs the attestation response', async () => {
    const startRegistration = vi.fn(async () => sampleRegResponse);

    const { api, calls } = makeApi({
      '/api/auth/webauthn/register/options': () =>
        jsonResponse({ data: sampleRegOptions }),
      '/api/auth/webauthn/register/verify': () =>
        new Response(null, { status: 204 }),
    });

    const client = createWebAuthnClient({
      api,
      loadSimpleWebAuthn: async () => ({
        startAuthentication: vi.fn(),
        startRegistration,
      }),
    });

    await client.register();

    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: sampleRegOptions,
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/api/auth/webauthn/register/options',
      'https://api.test/api/auth/webauthn/register/verify',
    ]);
  });

  it('abortConditional cancels in-flight conditional auth', () => {
    const { api } = makeApi({});
    const client = createWebAuthnClient({
      api,
      loadSimpleWebAuthn: async () => ({
        startAuthentication: vi.fn(),
        startRegistration: vi.fn(),
      }),
    });
    expect(() => client.abortConditional()).not.toThrow();
    expect(() => client.abortConditional()).not.toThrow();
  });
});
