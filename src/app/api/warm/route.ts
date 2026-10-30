// POST /api/warm — called once when the page loads. Starts fetching your repo list into
// the 5-minute cache, so even the first question gets Whisper's spelling hint. Sends
// nothing back. (POST, because with Cache Components a GET route could be prerendered.)

import { myRepos } from "@/lib/server/tools/listMyRepos";

export function POST() {
  void myRepos().catch(() => {}); // a GitHub problem shows up later, on a real question
  return new Response(null, { status: 204 });
}
