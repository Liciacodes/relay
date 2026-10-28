// POST /api/reply — runs only on the server.
// Gets the question (plus a little conversation memory) and STREAMS the answer back as
// plain text: the browser can show and speak the first words before the last are written.

import type { Turn } from "@/lib/audio/types";
import { streamChat } from "@/lib/server/groq";
import { fail, groqFailure, requireApiKey } from "@/lib/server/respond";

const MAX_TEXT = 2_000;
const MAX_HISTORY = 6; // the last 3 question/answer pairs

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn;
  return (
    (turn?.role === "user" || turn?.role === "assistant") &&
    typeof turn.content === "string" &&
    turn.content.length <= MAX_TEXT
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; history?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const history = Array.isArray(body?.history) ? body.history : [];

  if (!text || text.length > MAX_TEXT) {
    return fail(400, "reply-failed", "The question was empty or too long.");
  }
  if (history.length > MAX_HISTORY || !history.every(isTurn)) {
    return fail(400, "reply-failed", "The conversation history wasn't valid.");
  }

  const key = requireApiKey();
  if ("response" in key) return key.response;

  let answer: ReadableStream<string>;
  try {
    // This waits only until Groq starts answering, so errors like "rate limited"
    // still arrive as a normal JSON error before any text is sent.
    answer = await streamChat([...history, { role: "user", content: text }], key.apiKey);
  } catch (error) {
    return groqFailure(error, "reply-failed", "reply");
  }

  // Encode text to bytes and send it as it arrives. If Groq fails halfway, the stream
  // errors, the connection closes early, and the browser reports "reply failed".
  return new Response(answer.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
