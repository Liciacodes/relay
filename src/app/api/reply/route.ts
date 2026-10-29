// POST /api/reply — runs only on the server.
// Gets the question (plus a little conversation memory), lets the model look things up
// on GitHub with tools, and STREAMS the answer back as plain text: the browser can show
// and speak the first words before the last are written.

import type { Turn } from "@/lib/audio/types";
import { answerQuestion } from "@/lib/server/answer";
import { fail, replyFailure, requireApiKey } from "@/lib/server/respond";

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

  const pieces = answerQuestion([...history, { role: "user", content: text }], key.apiKey);

  let first: IteratorResult<string>;
  try {
    // Wait for the FIRST word of the answer. Any tool rounds happen before it, so errors
    // like "GitHub rejected the token" or "rate limited" still arrive as normal JSON.
    first = await pieces.next();
  } catch (error) {
    return replyFailure(error);
  }

  // Now stream: the first piece, then each next one as the generator produces it.
  const answer = new ReadableStream<string>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(first.value);
    },
    async pull(controller) {
      try {
        const next = await pieces.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        // Too late for a JSON error: close the stream early, the browser says "cut off".
        console.error("[reply] failed mid-answer:", error instanceof Error ? error.message : error);
        controller.error(error);
      }
    },
    cancel() {
      void pieces.return(undefined); // the browser went away: stop asking Groq
    },
  });

  return new Response(answer.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
