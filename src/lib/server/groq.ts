import "server-only"; // build fails if a browser component ever imports this file

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";
const TIMEOUT_MS = 30_000;

/** Groq answered with an error status. `status` lets the route pick a helpful message. */
export class GroqError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Groq responded ${status}: ${detail}`);
    this.name = "GroqError";
  }
}

/** Send audio to Groq's Whisper and return the transcript (may be an empty string). */
export async function transcribeWithGroq(audio: File, apiKey: string): Promise<string> {
  const body = new FormData();
  body.append("file", audio, audio.name);
  body.append("model", MODEL);
  body.append("response_format", "json");
  body.append("temperature", "0"); // least creative: write what was said

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GroqError(response.status, detail.slice(0, 300));
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}
