// POST /api/unlock { password } — the owner's password turns on full mode (private repos,
// creating issues) for 30 days, using a signed cookie the browser's JavaScript can't read.
// DELETE /api/unlock — back to the public demo.

import { canUnlock, checkPassword, lockCookie, unlockCookie, visitorOf } from "@/lib/server/access";
import { LIMITS, take } from "@/lib/server/limits";
import { fail } from "@/lib/server/respond";

export async function POST(request: Request) {
  if (!canUnlock()) return fail(404, "server", "Full mode isn't set up here (no RELAY_PASSWORD).");

  // A few tries per visitor every 15 minutes, so the password can't be guessed by brute force.
  if (!(await take(`unlock:${visitorOf(request)}`, LIMITS.unlockTries, LIMITS.unlockWindowS))) {
    return fail(429, "rate-limited", "Too many tries. Wait 15 minutes, then try again.");
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !checkPassword(password)) return fail(401, "server", "That password isn't right.");

  return Response.json({ mode: "full" }, { headers: { "Set-Cookie": unlockCookie() } });
}

export function DELETE() {
  return Response.json({ mode: "demo" }, { headers: { "Set-Cookie": lockCookie() } });
}
