import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

// PIN gate (E1-01 Feature A). Protects every admin route; no admin route may
// opt out (Business Rule 5). Public surfaces are ONLY:
//   /login                      — the PIN form
//   /display/[raffleId]         — the projector page (E2-01, no auth by design)
//   /api/display-meta/[id]      — structural metadata for the display page
// Everything else requires a valid signed session cookie.

const PUBLIC_PREFIXES = ["/login", "/display", "/api/display-meta"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = token ? await verifySessionToken(token) : false;

  if (isPublic) {
    // Already-authenticated user visiting /login → dashboard (Feature A, Alt 1)
    if (pathname === "/login" && authed) {
      return NextResponse.redirect(new URL("/raffles", request.url));
    }
    return NextResponse.next();
  }

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the originally requested path as return destination (A-01)
    if (pathname !== "/") loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Exclude Next internals and static assets; everything else passes through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
