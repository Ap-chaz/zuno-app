/**
 * Client-side biometric login using the WebAuthn platform authenticator
 * (Face ID / Touch ID / Android fingerprint / Windows Hello).
 *
 * IMPORTANT — what this does and doesn't do:
 * This registers a real device-bound credential and requires an actual
 * biometric prompt to unlock, so it's genuinely gating access with the
 * device's authenticator. What it does NOT do (because there's no backend
 * yet) is have a server verify the cryptographic signature — normally the
 * server would send a random challenge and check the signed response against
 * a stored public key. Here the "challenge" is generated client-side and
 * nothing remote confirms it, so this unlocks the *locally stored* ZUNO
 * session rather than proving identity to a server.
 *
 * Once a backend exists, swap `registerBiometric`/`verifyBiometric` to fetch
 * a real challenge from `/auth/webauthn/*` endpoints and post the resulting
 * attestation/assertion back for server-side verification — the browser-side
 * API calls below barely change, only where the challenge comes from does.
 */

const CREDENTIAL_ID_KEY = "zuno_webauthn_credential_id";
const RP_NAME = "ZUNO";

export function isBiometricSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function hasRegisteredBiometric(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(CREDENTIAL_ID_KEY);
}

export async function registerBiometric(userId: string, userName: string): Promise<boolean> {
  if (!isBiometricSupported()) throw new Error("Biometric login isn't supported on this device or browser.");

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: RP_NAME },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
        requireResidentKey: false,
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) return false;
  window.localStorage.setItem(CREDENTIAL_ID_KEY, bufferToBase64Url(credential.rawId));
  return true;
}

export async function verifyBiometric(): Promise<boolean> {
  if (!isBiometricSupported()) throw new Error("Biometric login isn't supported on this device or browser.");
  const credentialId = window.localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!credentialId) throw new Error("No biometric credential is registered on this device yet.");

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      userVerification: "required",
      timeout: 60_000,
      // Without this, the browser has no discoverable credential to offer
      // and shows "No passkeys available" even though one was registered.
      allowCredentials: [
        {
          type: "public-key",
          id: base64UrlToBuffer(credentialId),
          transports: ["internal"],
        },
      ],
    },
  });

  return !!assertion;
}

export function clearBiometric(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CREDENTIAL_ID_KEY);
}
