// Ids. Batch ids must satisfy core Envelope's rule ([A-Za-z0-9_-]{4,64}) and
// survive the host's @-reference parser unquoted.
//
// A batch id is also the only key to its annotations: `@diple:<id>` expands in
// any session of the profile that types it (the host gives the provider no
// trusted session to check, see docs/known-limitations.md). So batch ids
// are unguessable: 26 base32 characters = 130 random bits (R1 XE-14). This
// exact shape is core Envelope.BATCH_ID_SOURCE: the provider and the send
// middleware treat nothing else as a reference (B-1).

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567' // 32 symbols: 5 unbiased bits per byte
const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'

function random(n, alphabet) {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export const newBatchId = () => `b${random(26, BASE32)}`
export const newItemId = () => `x${random(10, ALPHABET)}`
