// POST /api/warm — called once when the page loads. Starts fetching your repo list into
// the 5-minute cache, so even the first question gets Whisper's spelling hint, and tells
// the page which mode it's in: { mode: "demo" | "full", owner, canUnlock }.
// (POST, because with Cache Components a GET route could be prerendered.)

import { canUnlock, modeOf } from "@/lib/server/access";
import { myLogin } from "@/lib/server/github";
import { myRepos } from "@/lib/server/tools/listMyRepos";

export async function POST(request: Request) {
  const mode = modeOf(request);
  void myRepos(mode).catch(() => {}); // a GitHub problem shows up later, on a real question
  const owner = await myLogin().catch(() => null); // public anyway: whose GitHub this is
  return Response.json({ mode, owner, canUnlock: canUnlock() });
}
