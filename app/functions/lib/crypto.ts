const IV_LENGTH_BYTES = 12;
const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  // parseInt("zz", 16) is NaN, and a NaN assigned into a Uint8Array becomes 0 --
  // so a typo'd or whitespace-mangled key would silently become an all-zero key
  // that still passes a length check. Reject anything non-hex outright.
  if (!KEY_PATTERN.test(hex)) throw new Error("encryption key must be 64 hex characters");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function importKey(rawKey: string): Promise<CryptoKey> {
  if (!rawKey) throw new Error("encryption key is not configured");
  return crypto.subtle.importKey("raw", hexToBytes(rawKey), "AES-GCM", false, ["encrypt"]);
}

/** AES-256-GCM, returning `ivHex:ciphertextHex` — the format `scripts/lib/crypto.py`
 * decrypts, so the Python worker can read credentials without a second format. */
export async function encryptValue(plaintext: string, rawKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await importKey(rawKey);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  return `${bytesToHex(iv)}:${bytesToHex(ciphertext)}`;
}
