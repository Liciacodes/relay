// POST /api/transcribe — runs only on the server.
// The browser sends audio here; we add the secret GROQ_API_KEY and forward it to Groq.
// (No `export const runtime`: with Cache Components on, Next.js always uses Node here.)

import { GroqError, transcribeWithGroq } from "@/lib/server/groq";
import type { TranscribeResponse, VoiceErrorCode } from "@/lib/audio/errors";

const MIN_BYTES = 1_000; // smaller than this is a click, not speech
const MAX_BYTES = 25 * 1024 * 1024; // Groq's upload limit for free accounts

function fail(status: number, code: VoiceErrorCode, message: string) {
  return Response.json({ error: { code, message } } satisfies TranscribeResponse, { status });
}

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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return fail(500, "server", "GROQ_API_KEY is missing. Add it to .env.local and restart the dev server.");
  }

  try {
    const text = await transcribeWithGroq(audio, apiKey);
    if (!text) {
      return fail(422, "empty-audio", "Didn't catch any words. Try again a little closer to the mic.");
    }
    return Response.json({ text } satisfies TranscribeResponse);
  } catch (error) {
    // Log the reason for you in the terminal. The key is never part of the error.
    console.error("[transcribe]", error instanceof Error ? error.message : error);

    if (error instanceof GroqError && error.status === 401) {
      return fail(502, "server", "Groq rejected the API key. Check GROQ_API_KEY in .env.local.");
    }
    if (error instanceof GroqError && error.status === 429) {
      return fail(503, "server", "Groq's rate limit was reached. Wait a moment and try again.");
    }
    return fail(502, "server", "Transcription failed. Try again in a moment.");
  }
}
