import { VoiceError, type TranscribeResponse } from "./audio/errors";

const TIMEOUT_MS = 30_000;

// Groq works out the audio format from the file extension, so the name matters.
function fileNameFor(type: string) {
  if (type.includes("mp4")) return "speech.mp4";
  if (type.includes("ogg")) return "speech.ogg";
  return "speech.webm";
}

/** Browser side: send a recording to our own server route and get the text back. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, fileNameFor(blob.type));

  let response: Response;
  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // fetch only throws when no response arrived: offline, server down, or timed out.
    throw new VoiceError("network");
  }

  const data = (await response.json().catch(() => null)) as TranscribeResponse | null;

  if (!data) throw new VoiceError("server");
  if ("error" in data) throw new VoiceError(data.error.code, data.error.message);
  return data.text;
}
