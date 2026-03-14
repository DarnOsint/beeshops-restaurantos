// PIN Hashing — Web Crypto API (works in browser + Deno Edge Functions)
// Uses PBKDF2 with a per-PIN salt derived from the staff ID for proper security.
// Format stored: "pbkdf2:<iterations>:<salt_hex>:<hash_hex>"

const ITERATIONS = 100_000
const KEY_LENGTH = 32 // 256 bits

async function deriveKey(pin: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const salt = hexToBytes(saltHex)
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return bytesToHex(new Uint8Array(bits))
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** Hash a PIN for storage. Returns "pbkdf2:<iterations>:<salt>:<hash>" */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomSaltHex()
  const hash = await deriveKey(pin, salt)
  return `pbkdf2:${ITERATIONS}:${salt}:${hash}`
}

/** Verify a plain PIN against a stored hash string */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  // Support legacy plain-text PINs (4 digits) during migration
  if (!stored.startsWith('pbkdf2:')) {
    return pin === stored
  }
  const parts = stored.split(':')
  if (parts.length !== 4) return false
  const [, , salt, expectedHash] = parts
  const actualHash = await deriveKey(pin, salt)
  return actualHash === expectedHash
}

/** Check if a stored PIN value is already hashed */
export function isPinHashed(stored: string): boolean {
  return stored.startsWith('pbkdf2:')
}
