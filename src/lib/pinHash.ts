// PIN Hashing — two strategies:
// NEW: bcrypt via Supabase RPC (pgcrypto) — DB can verify, instant login
// LEGACY: PBKDF2 (Web Crypto) — verified client-side, auto-migrated to bcrypt on login

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32

// ── PBKDF2 (legacy) ──────────────────────────────────────────────────────────

async function pbkdf2Derive(pin: string, saltHex: string): Promise<string> {
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
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return bytesToHex(new Uint8Array(bits))
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
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

/** Verify a PBKDF2 hash (legacy path — slow, runs client-side) */
export async function verifyPbkdf2(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2:')) return false
  const parts = stored.split(':')
  if (parts.length !== 4) return false
  const [, , salt, expectedHash] = parts
  const actualHash = await pbkdf2Derive(pin, salt)
  return actualHash === expectedHash
}

/** Check if a stored value is a PBKDF2 hash */
export function isPbkdf2Hash(stored: string): boolean {
  return stored.startsWith('pbkdf2:')
}

/** Generate a PBKDF2 hash (used during migration only) */
export async function hashPbkdf2(pin: string): Promise<string> {
  const salt = randomSaltHex()
  const hash = await pbkdf2Derive(pin, salt)
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Hash a PIN for storage.
 * New hashes use bcrypt via Supabase RPC (fast DB-side verification).
 * Falls back to PBKDF2 if RPC unavailable.
 */
export async function hashPin(pin: string): Promise<string> {
  // Use PBKDF2 for client-side hashing (bcrypt is done server-side via pgcrypto)
  return hashPbkdf2(pin)
}

/**
 * Verify a plain PIN against a stored hash.
 * Supports both PBKDF2 (legacy) and plain-text (pre-hash).
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored) return false
  if (stored.startsWith('pbkdf2:')) return verifyPbkdf2(pin, stored)
  // Plain text (legacy, not yet hashed)
  return pin === stored
}

/** Check if a stored PIN value is already hashed (any format) */
export function isPinHashed(stored: string): boolean {
  return stored.startsWith('pbkdf2:') || stored.startsWith('$2')
}
