import { VoiceError, errorFromResponse } from "./audio/errors";
import type { Turn } from "./audio/types";
import type { Evidence, ReplyEvent, ToolStep } from "./evidence";
import type { IssueDraft } from "./issues";

const TIMEOUT_MS = 60_000; // tool rounds (GitHub lookups) add a few seconds

export interface ReplyHandlers {
  /** A piece of the answer text. */
  onText: (piece: string) => void;
  /** A tool lookup finished on the server. */
  onStep?: (step: ToolStep) => void;
  /** The evidence cards for this answer (sent once, at the end). */
  onEvidence?: (items: Evidence[]) => void;
  /** Relay drafted an issue. Nothing is created until you press Confirm. */
  onDraft?: (draft: IssueDraft) => void;
  /** Aborting it cancels the answer (you interrupted). streamReply then throws an AbortError. */
  signal?: AbortSignal;
}

/** True for the error thrown when you interrupted (aborted) the answer. */
export function isInterruption(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Browser side: ask /api/reply for an answer and receive it as it's written.
 *
 * The response is NDJSON: one JSON object per line. `response.body` is a ReadableStream of
 * bytes; we read it piece by piece, turn the bytes into text, cut the text at each "\n",
 * and handle every complete line by its `type`. Returns the full answer text at the end.
 */
export async function streamReply(text: string, history: Turn[], handlers: ReplyHandlers): Promise<string> {
  const interrupted = () => new DOMException("Interrupted", "AbortError");
  // AbortSignal.any: stop on whichever comes first, you interrupting or the timeout.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = handlers.signal ? AbortSignal.any([handlers.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, history }),
      signal,
    });
  } catch {
    if (handlers.signal?.aborted) throw interrupted();
    throw new VoiceError("network");
  }

  // A bad request (empty or too long) comes back as normal JSON, before any streaming.
  if (!response.ok || !response.body) throw await errorFromResponse(response, "reply-failed");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ""; // a piece can end halfway through a line: keep that part for next time
  let answer = "";

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ReplyEvent;
    switch (event.type) {
      case "text":
        answer += event.text;
        handlers.onText(event.text);
        break;
      case "step":
        handlers.onStep?.({ label: event.label, ms: event.ms, ok: event.ok });
        break;
      case "evidence":
        handlers.onEvidence?.(event.items);
        break;
      case "draft":
        handlers.onDraft?.(event.draft);
        break;
      case "error":
        throw new VoiceError(event.error.code, event.error.message);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read(); // waits for the next piece
      // stream: true = a character split across two pieces is kept until it's complete
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
      if (done) break;
    }
    handle(buffer);
  } catch (error) {
    if (handlers.signal?.aborted) throw interrupted(); // you cut it off: not a failure
    if (error instanceof VoiceError) throw error; // an `error` line from the server
    // The connection broke halfway, or a line wasn't valid JSON.
    throw new VoiceError("reply-failed", "The answer was cut off. Try again.");
  }

  if (!answer.trim()) throw new VoiceError("reply-failed");
  return answer;
}
