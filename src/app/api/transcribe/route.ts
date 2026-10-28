// POST /api/transcribe — runs only on the server.
// The browser sends audio here; we add the secret GROQ_API_KEY and forward it to Groq.
// (No `export const runtime`: with Cache Components on, Next.js always uses Node here.)

import { transcribeWithGroq } from "@/lib/server/groq";
import { fail, groqFailure, requireApiKey } from "@/lib/server/respond";
import type { TranscribeResponse } from "@/lib/audio/errors";

const MIN_BYTES = 1_000; // smaller than this is a click, not speech
const MAX_BYTES = 25 * 1024 * 1024; // Groq's upload limit for free accounts

export async function POST(request: Request) {
  let audio: FormDataEntryValue | null = null;
  try {
    audio = (await request.formData()).get("audio");
  } catch {
    // body wasn't form data at all
  }

  if (!(audio instanceof File) || audio.size < MIN_BYTES) {
    return fail(400, "empty-audio", "Nothing to transcribe. Keep holding while you speak, then let go.");
  }
  if (audio.size > MAX_BYTES) {
    return fail(413, "server", "That recording is too large to transcribe.");
  }

  const key = requireApiKey();
  if ("response" in key) return key.response;

  try {
    const text = await transcribeWithGroq(audio, key.apiKey);
    if (!text) {
      return fail(422, "empty-audio", "Didn't catch any words. Try again a little closer to the mic.");
    }
    return Response.json({ text } satisfies TranscribeResponse);
  } catch (error) {
    return groqFailure(error, "server", "transcribe");
  }
}
