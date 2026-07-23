"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { fail, type ActionResult } from "@/lib/action-result";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { pinSchema } from "@/lib/validation";

/**
 * Only ever redirect to an in-app path — never an absolute/protocol-relative
 * URL supplied via ?from= (open-redirect hardening).
 */
function safeReturnPath(from: string | null | undefined): string {
  if (from && from.startsWith("/") && !from.startsWith("//")) {
    return from;
  }
  return "/raffles";
}

/**
 * PIN login (E1-01 Feature A). Verifies the submitted PIN against the bcrypt
 * hash in ADMIN_PIN_HASH — server-side only, never plain text. On success,
 * sets a signed httpOnly session cookie and redirects to the return path.
 * On failure, returns an ActionResult so the form can render the exact
 * FSD-specified message. Never resolves with ok:true — success redirects.
 */
export async function login(
  pin: string,
  from?: string | null
): Promise<ActionResult<never>> {
  const parsed = pinSchema.safeParse({ pin });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please enter your PIN.");
  }

  const hash = process.env.ADMIN_PIN_HASH;
  if (!hash || !hash.startsWith("$2")) {
    // Fail closed: no valid hash means no PIN can ever succeed (Feature A).
    console.error("ADMIN_PIN_HASH is missing or malformed; login fails closed.");
    return fail("Login is temporarily unavailable.");
  }

  let matches = false;
  try {
    matches = await bcrypt.compare(parsed.data.pin, hash);
  } catch (err) {
    console.error("bcrypt comparison failed:", err);
    return fail("Login is temporarily unavailable.");
  }

  if (!matches) {
    return fail("Incorrect PIN. Please try again.");
  }

  const token = await createSessionToken();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());

  redirect(safeReturnPath(from));
}

/** Clears the session cookie and returns to /login (E1-01 A-03 / D-E14). */
export async function logout(): Promise<never> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
