/**
 * Web Crypto (AES-GCM) helpers for encrypting the offline checkout queue at rest
 * (R-7). Pure-ish + dependency-free: it leans only on the standard Web Crypto API
 * (`crypto.subtle`) available in every target browser and in Node's test env, so
 * there is NO new dependency.
 *
 * Design:
 *  - A per-browser 256-bit AES-GCM key is generated with `extractable: false`
 *    and stored as a live `CryptoKey` in IndexedDB. Because the key is
 *    non-extractable, its raw bytes are never readable from JS — an attacker with
 *    DevTools (or another script) can read the IndexedDB *entry* but cannot
 *    export the key material, only ask the browser to encrypt/decrypt with it.
 *  - Each queued payload is serialized to JSON, encrypted under a fresh random
 *    96-bit IV, and persisted as an `EncryptedEnvelope { v, iv, ct }` of raw
 *    bytes (IndexedDB structured-clone stores `Uint8Array` natively).
 *
 * This module is intentionally storage-agnostic for the crypto core
 * (`encryptJson`/`decryptJson` take a key) so it is unit-testable without
 * IndexedDB; only `getOrCreateOfflineKey` touches IndexedDB.
 */

/** AES-GCM recommends a 96-bit (12-byte) IV. */
const IV_BYTES = 12;
/** Envelope format version, so a future re-key/format change is detectable. */
const ENVELOPE_VERSION = 1 as const;

/** An encrypted payload as persisted in IndexedDB. Raw bytes (no base64). */
export interface EncryptedEnvelope {
  /** Format version. */
  v: typeof ENVELOPE_VERSION;
  /** Random per-message initialization vector. */
  iv: Uint8Array;
  /** AES-GCM ciphertext (includes the auth tag). */
  ct: Uint8Array;
}

/** Narrow runtime check that a stored value is an encrypted envelope (vs legacy plaintext). */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === ENVELOPE_VERSION &&
    v.iv instanceof Uint8Array &&
    v.ct instanceof Uint8Array
  );
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("Web Crypto (crypto.subtle) is not available in this environment.");
  }
  return c.subtle;
}

/** Generate a fresh, non-extractable AES-GCM 256-bit key. */
export async function generateOfflineKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, /* extractable */ false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a JSON-serializable value under `key`. Returns a self-describing
 * envelope (version + random IV + ciphertext) safe to persist in IndexedDB.
 */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedEnvelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ctBuf = await subtle().encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { v: ENVELOPE_VERSION, iv, ct: new Uint8Array(ctBuf) };
}

/**
 * Decrypt an envelope produced by {@link encryptJson} back into the original
 * value. Throws if the key is wrong or the ciphertext/IV was tampered with
 * (AES-GCM authentication failure) or the format is unrecognized.
 */
export async function decryptJson<T = unknown>(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
): Promise<T> {
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error("Not a recognized encrypted envelope.");
  }
  // `subtle.decrypt` wants a BufferSource; pass the raw bytes through.
  const ptBuf = await subtle().decrypt(
    { name: "AES-GCM", iv: envelope.iv },
    key,
    envelope.ct,
  );
  return JSON.parse(new TextDecoder().decode(ptBuf)) as T;
}

// --- Key persistence (IndexedDB) -------------------------------------------
//
// The key lives in its own tiny IndexedDB database, separate from the checkout
// queue, so wiping the queue on sign-out doesn't destroy the key mid-flight and
// vice-versa. We store the live `CryptoKey` object directly: IndexedDB's
// structured-clone algorithm persists a non-extractable `CryptoKey` without ever
// exposing its raw bytes to JS.

const KEY_DB_NAME = "vallapos-offline-key";
const KEY_DB_VERSION = 1;
const KEY_STORE = "key";
const KEY_ID = "offline-aesgcm";

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const req = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open offline key DB."));
  });
}

function idbGet(db: IDBDatabase, store: string, id: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(
  db: IDBDatabase,
  store: string,
  value: unknown,
  id: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let keyPromise: Promise<CryptoKey> | null = null;

/**
 * Fetch the per-browser offline encryption key, generating + persisting one on
 * first use. Memoized for the page lifetime. The returned `CryptoKey` is
 * non-extractable: usable for encrypt/decrypt but its bytes never reach JS.
 */
export async function getOrCreateOfflineKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const db = await openKeyDB();
      try {
        const existing = await idbGet(db, KEY_STORE, KEY_ID);
        if (existing instanceof CryptoKey) return existing;
        const key = await generateOfflineKey();
        await idbPut(db, KEY_STORE, key, KEY_ID);
        return key;
      } finally {
        db.close();
      }
    })();
    // Don't cache a rejected promise — let the next call retry.
    keyPromise.catch(() => {
      keyPromise = null;
    });
  }
  return keyPromise;
}

/** Test/diagnostic hook: forget the memoized key promise. */
export function __resetOfflineKeyCache(): void {
  keyPromise = null;
}

/**
 * Wipe the persisted offline key (sign-out hygiene companion to clearing the
 * queue). Without the key, any envelopes that somehow survive are undecryptable.
 */
export async function clearOfflineKey(): Promise<void> {
  __resetOfflineKeyCache();
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(KEY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
