import "server-only";

import type { ApiError, VoiceErrorCode } from "@/lib/audio/errors";
import { GroqError } from "./groq";

/** Send our standard `{ error: { code, message } }` JSON with an HTTP status. */
export function fail(status: number, code: VoiceErrorCode, message?: string, headers?: HeadersInit) {
  const body: ApiError = { error: { code, message: message ?? defaultMessage(code) } };
  return Response.json(body, { status, headers });
}

function defaultMessage(code: VoiceErrorCode) {
  if (code === "reply-failed") return "Couldn't get an answer. Try again.";
  if (code === "speech-failed") return "Couldn't create the voice for this answer.";
  return "Something went wrong on the server. Try again in a moment.";
}

/** The API key, or a ready-made error response if it isn't set. */
export function requireApiKey(): { apiKey: string } | { response: Response } {
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) return { apiKey };
  return {
    response: fail(500, "server", "GROQ_API_KEY is missing. Add it to .env.local and restart the dev server."),
  };
}

/**
 * Turn a failed Groq call into a clear response. `code` is what to report when the
 * failure isn't one of the special cases (bad key, rate limit, terms not accepted).
 */
export function groqFailure(error: unknown, code: VoiceErrorCode, label: string): Response {
  // Log the reason for you in the terminal. The key is never part of the error.
  console.error(`[${label}]`, error instanceof Error ? error.message : error);

  if (!(error instanceof GroqError)) return fail(502, code);

  if (error.status === 401) {
    return fail(502, "server", "Groq rejected the API key. Check GROQ_API_KEY in .env.local.");
  }
  if (error.status === 429) {
    const wait = error.retryAfter;
    const when = wait ? `in ${Math.ceil(wait)} seconds` : "in a minute";
    return fail(429, "rate-limited", `Groq's usage limit was reached. Try again ${when}.`, {
      "Retry-After": String(Math.ceil(wait ?? 60)),
    });
  }
  if (error.groqCode === "model_terms_required") {
    return fail(
      403,
      code,
      "Groq's voice needs a one-time approval: accept the Orpheus terms at console.groq.com (Playground → canopylabs/orpheus-v1-english).",
    );
  }
  return fail(502, code);
}
