import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
  readonly workspaceId: string;
}

/**
 * Subset of `@simplewebauthn/browser` used by the auth client. Importing
 * lazily lets the SimpleWebAuthn bundle load only when the user actually
 * touches a passkey flow.
 */
export interface SimpleWebAuthnBrowser {
  startAuthentication(opts: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
    useBrowserAutofill?: boolean;
  }): Promise<AuthenticationResponseJSON>;
  startRegistration(opts: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }): Promise<RegistrationResponseJSON>;
}

export type SimpleWebAuthnLoader = () => Promise<SimpleWebAuthnBrowser>;

export type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
};
