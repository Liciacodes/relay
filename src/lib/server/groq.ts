import "server-only"; // build fails if a browser component ever imports this file

import type { Turn } from "@/lib/audio/types";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const TIMEOUT_MS = 30_000;

// Model choices (checked against Groq's model list on 2026-10-28).
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const CHAT_MODEL = "openai/gpt-oss-20b"; // fastest production chat model
const TTS_MODEL = "canopylabs/orpheus-v1-english";
const VOICE = "hannah";
export const TTS_MAX_CHARS = 200; // Orpheus rejects longer input

// The instructions the model gets before every conversation.
const SYSTEM_PROMPT = `You are Relay, a voice assistant for software engineers.
Everything you write is read aloud, so:
- Answer in 2 to 4 short, natural spoken sentences.
- No markdown, lists, headings, code blocks, URLs, or emoji.
- Say numbers and symbols the way a person would say them.
- If you don't know something, say so briefly.
You can't see the user's GitHub data yet; if asked about it, say that's coming soon.`;

/** Groq answered with an error. The route uses these details to pick a helpful message. */
export class GroqError extends Error {
  constructor(
    readonly status: number,
    /** Groq's own error code, e.g. "model_terms_required". */
    readonly groqCode: string | undefined,
    /** Seconds to wait, from the retry-after header (only on 429). */
    readonly retryAfter: number | undefined,
    detail: string,
  ) {
    super(`Groq responded ${status}${groqCode ? ` (${groqCode})` : ""}: ${detail}`);
    this.name = "GroqError";
  }
}

/** One authenticated request to Groq. Throws GroqError for any non-2xx answer. */
async function groqFetch(path: string, apiKey: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${GROQ_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.ok) return response;

  const body = await response.text().catch(() => "");
  let groqCode: string | undefined;
  try {
    groqCode = (JSON.parse(body) as { error?: { code?: string } }).error?.code;
  } catch {
    // not JSON; keep the raw text as detail
  }
  const retryAfter = Number(response.headers.get("retry-after")) || undefined;
  throw new GroqError(response.status, groqCode, retryAfter, body.slice(0, 300));
}

/** Send audio to Groq's Whisper and return the transcript (may be an empty string). */
export async function transcribeWithGroq(audio: File, apiKey: string): Promise<string> {
  const body = new FormData();
  body.append("file", audio, audio.name);
  body.append("model", TRANSCRIBE_MODEL);
  body.append("response_format", "json");
  body.append("temperature", "0"); // least creative: write what was said

  const response = await groqFetch("/audio/transcriptions", apiKey, { method: "POST", body });
  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Ask the chat model for an answer and get it back as a stream of text pieces.
 *
 * Groq streams "Server-Sent Events": lines like `data: {...json...}`, ending with
 * `data: [DONE]`. The answer text sits in choices[0].delta.content. We unwrap those lines
 * here, so whoever reads this stream only ever sees plain text.
 */
export async function streamChat(history: Turn[], apiKey: string): Promise<ReadableStream<string>> {
  const response = await groqFetch("/chat/completions", apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      stream: true,
      // gpt-oss "thinks" before answering. Keep that short, and leave it out of the stream.
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 600,
      temperature: 0.7,
    }),
  });

  if (!response.body) throw new GroqError(502, undefined, undefined, "empty stream");
  return response.body.pipeThrough(new TextDecoderStream()).pipeThrough(sseToText());
}

/** A TransformStream: raw SSE text goes in, answer text comes out. */
function sseToText(): TransformStream<string, string> {
  let buffer = ""; // a network chunk can end halfway through a line

  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the unfinished last line for next time

      for (const line of lines) {
        if (!line.startsWith("data:")) continue; // blank lines separate events
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        const event = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        if (event.error) throw new Error(`Groq stream error: ${event.error.message}`);
        const text = event.choices?.[0]?.delta?.content;
        if (text) controller.enqueue(text);
      }
    },
  });
}

/** Turn up to 200 characters of text into speech. Returns WAV audio bytes. */
export async function synthesizeSpeech(text: string, apiKey: string): Promise<ArrayBuffer> {
  const response = await groqFetch("/audio/speech", apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: VOICE, input: text, response_format: "wav" }),
  });
  return fixWavSizes(await response.arrayBuffer());
}

/**
 * Groq sends WAV made for streaming, whose header says "length unknown" (0xFFFFFFFF).
 * Some browsers refuse to decode that, so we write the real sizes into the header.
 * A WAV file is a "RIFF" container: a list of chunks, each starting with a 4-letter name
 * and a 4-byte size. The audio samples live in the "data" chunk.
 */
function fixWavSizes(wav: ArrayBuffer): ArrayBuffer {
  const view = new DataView(wav);
  const name = (at: number) => String.fromCharCode(...new Uint8Array(wav, at, 4));
  if (wav.byteLength < 12 || name(0) !== "RIFF" || name(8) !== "WAVE") return wav;

  view.setUint32(4, wav.byteLength - 8, true); // whole-file size
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    if (name(offset) === "data") {
      view.setUint32(offset + 4, wav.byteLength - offset - 8, true); // audio size
      break;
    }
    offset += 8 + view.getUint32(offset + 4, true);
  }
  return wav;
}
