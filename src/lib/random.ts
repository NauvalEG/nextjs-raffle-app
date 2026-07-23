// Cryptographically secure, uniform random index — the single shared selector
// for ALL draw paths (E1-04 Feature 4.1; reused verbatim by E2-02 redraw).
// Server-side crypto.getRandomValues only. Math.random must never appear in
// any draw path (PRD E1-04 AC1) — enforced by lint/static check and tests.

/**
 * Returns a uniformly distributed integer in [0, n-1] using rejection
 * sampling over crypto.getRandomValues, avoiding modulo bias.
 */
export function secureRandomIndex(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`secureRandomIndex requires a positive integer pool size, got ${n}`);
  }
  if (n === 1) return 0;

  // Rejection sampling: draw 32-bit values, discard those in the biased tail.
  const range = 0x100000000; // 2^32
  const limit = range - (range % n); // largest multiple of n within range
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}
