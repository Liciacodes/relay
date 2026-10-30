// POST /api/reply — runs only on the server.
// Gets the question (plus a little conversation memory), lets the model look things up
// on GitHub with tools, and STREAMS everything back as NDJSON (one JSON object per line):
// tool steps, the answer's words as they're written, then the evidence cards.

import type { Turn } from "@/lib/audio/types";
import type { ReplyEvent } from "@/lib/evidence";
import { modeOf, visitorOf } from "@/lib/server/access";
import { answerQuestion } from "@/lib/server/answer";
import { LIMITS, take } from "@/lib/server/limits";
import { describeReplyFailure, fail, requireApiKey } from "@/lib/server/respond";

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

  // The public demo has daily limits, so visitors can't use up the free Groq quota.
  const mode = modeOf(request);
  if (
    mode === "demo" &&
    !((await take(`q:${visitorOf(request)}`, LIMITS.questionsPerVisitor)) && (await take("q:all", LIMITS.questionsTotal)))
  ) {
    return fail(429, "demo-limit");
  }

  const events = answerQuestion([...history, { role: "user", content: text }], key.apiKey, mode);

  // Stream NDJSON: each event becomes one line of JSON. The response starts right away,
  // so tool steps reach the browser live, while it still shows "Thinking".
  let cancelled = false;
  const lines = new ReadableStream<string>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (cancelled) return; // the browser left while we were waiting
        if (next.done) controller.close();
        else controller.enqueue(`${JSON.stringify(next.value)}\n`);
      } catch (error) {
        if (cancelled) return;
        // Anything that fails (GitHub token, rate limit, Groq) becomes a last `error` line.
        const event: ReplyEvent = { type: "error", ...describeReplyFailure(error) };
        controller.enqueue(`${JSON.stringify(event)}\n`);
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      void events.return(undefined); // the browser went away: stop asking Groq
    },
  });

  return new Response(lines.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
