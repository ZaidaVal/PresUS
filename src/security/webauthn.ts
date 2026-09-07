import { bytesToB64, b64ToBytes, randomBytes } from './crypto';
import { getSecureStore, type KvStore } from './secureStore';

const CRED_KEY = 'webauthn.credentialId';

function store(kv?: KvStore) {
  return kv ?? getSecureStore();
}

export function webauthnAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export async function readWebauthnCredentialId(kv?: KvStore): Promise<string | undefined> {
  return store(kv).get(CRED_KEY);
}

export async function hasWebauthn(kv?: KvStore): Promise<boolean> {
  return Boolean(await readWebauthnCredentialId(kv));
}

function rpId(): string {
  return window.location.hostname;
}

export async function registerWebauthn(kv?: KvStore): Promise<void> {
  if (!webauthnAvailable()) throw new Error('Este dispositivo no ofrece huella ni Windows Hello');
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: 'PresUS', id: rpId() },
      user: {
        id: randomBytes(16) as BufferSource,
        name: 'finanzas-za',
        displayName: 'Administrador PresUS',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('No se registró la huella');
  await store(kv).set(CRED_KEY, bytesToB64(new Uint8Array(credential.rawId)));
}

export async function verifyWebauthn(kv?: KvStore): Promise<void> {
  const stored = await readWebauthnCredentialId(kv);
  if (!stored) throw new Error('No hay huella registrada');
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: b64ToBytes(stored) as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!assertion) throw new Error('No se pudo verificar la huella');
}

export async function clearWebauthn(kv?: KvStore): Promise<void> {
  await store(kv).delete(CRED_KEY);
}
