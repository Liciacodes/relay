import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Two ways to use Relay online:
//   demo  anyone with the link: public repos only, read-only, daily limits
//   full  the owner, after entering RELAY_PASSWORD: everything, as on your own computer
// Every demo rule is checked on the server; the page only shows which mode you're in.

export type Mode = "demo" | "full";

const COOKIE = "relay_full";
const MAX_AGE_S = 30 * 24 * 60 * 60; // unlocked for 30 days

const password = () => process.env.RELAY_PASSWORD || null;
const production = process.env.NODE_ENV === "production";

/**
 * The cookie's value is "<expiry>.<signature>". The signature is an HMAC: a fingerprint of
 * the expiry made with the password as the key, so nobody can make one without knowing
 * the password. Changing the password signs everyone out.
 */
function sign(expires: number, secret: string) {
  return createHmac("sha256", secret).update(`full:${expires}`).digest("base64url");
}

/** Compare two secrets in constant time, so the time taken doesn't hint at the answer. */
function same(a: string, b: string) {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Demo or full, for this request. */
export function modeOf(request: Request): Mode {
  const secret = password();
  // No password set: full on your own computer (npm run dev), demo online (never open by mistake).
  if (!secret) return production ? "demo" : "full";

  const [expiresText, signature] = (readCookie(request, COOKIE) ?? "").split(".");
  const expires = Number(expiresText);
  if (!signature || !expires || expires < Date.now() / 1000) return "demo";
  return same(signature, sign(expires, secret)) ? "full" : "demo";
}

/** Is full mode available at all (a password is set)? */
export const canUnlock = () => password() !== null;

export function checkPassword(given: string): boolean {
  const secret = password();
  return secret !== null && same(given, secret);
}

const attributes = `Path=/; HttpOnly; SameSite=Strict${production ? "; Secure" : ""}`;

/** The Set-Cookie header that unlocks full mode for 30 days. */
export function unlockCookie(): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return `${COOKIE}=${expires}.${sign(expires, password()!)}; ${attributes}; Max-Age=${MAX_AGE_S}`;
}

/** The Set-Cookie header that goes back to the demo. */
export const lockCookie = () => `${COOKIE}=; ${attributes}; Max-Age=0`;

/**
 * Who's asking, for the per-visitor limits: a hash of their IP address and today's date,
 * so the address itself is never stored and can't be followed from one day to the next.
 */
export function visitorOf(request: Request): string {
  // Vercel sets x-real-ip itself; the all-visitors daily caps apply whatever this says.
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${day}`).digest("base64url").slice(0, 16);
}
