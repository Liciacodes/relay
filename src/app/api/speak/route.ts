// POST /api/speak — runs only on the server.
// Turns one chunk of the answer (max 200 characters) into WAV audio with Groq's Orpheus voice.

import { TTS_MAX_CHARS, synthesizeSpeech } from "@/lib/server/groq";
import { fail, groqFailure, requireApiKey } from "@/lib/server/respond";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text || text.length > TTS_MAX_CHARS) {
    return fail(400, "speech-failed", `Speech text must be 1 to ${TTS_MAX_CHARS} characters.`);
  }

  const key = requireApiKey();
  if ("response" in key) return key.response;

  try {
    const wav = await synthesizeSpeech(text, key.apiKey);
    return new Response(wav, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return groqFailure(error, "speech-failed", "speak");
  }
}
