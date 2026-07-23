import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Stateless signed session (E1-01 A-10): short random token embedded in a
// signed JWT with a 24h expiry (A-02). httpOnly + Secure + SameSite cookie.
// Signature verification runs server-side on every admin request (middleware).

export const SESSION_COOKIE = "raffle_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours (A-02)

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: no secret means no session can ever verify.
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const tokenId = Buffer.from(random).toString("hex");
  return new SignJWT({ sid: tokenId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.sid === "string" && payload.sid.length > 0;
  } catch {
    return false; // expired, tampered, or unsigned — treated as no session
  }
}

/** Server-side check for use in Server Actions / route handlers (defense in depth beyond middleware). */
export async function requireSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    throw new Error("UNAUTHENTICATED");
  }
}

export async function hasValidSession(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return !!token && (await verifySessionToken(token));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
