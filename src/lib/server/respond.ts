import "server-only";

import type { ApiError, VoiceErrorCode } from "@/lib/audio/errors";
import { GitHubError } from "./github";
import { GroqError } from "./groq";

/** A failure, described once: used for JSON responses and for /api/reply's error line. */
interface Problem {
  status: number;
  code: VoiceErrorCode;
  message: string;
  headers?: HeadersInit;
}

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
 * Describe a failed answer (GitHub or Groq) for /api/reply's `error` line.
 * The answer is already streaming by then, so this is data, not an HTTP response.
 */
export function describeReplyFailure(error: unknown): ApiError {
  // Log the reason for you in the terminal. Keys and tokens are never part of the error.
  console.error("[reply]", error instanceof Error ? error.message : error);
  const { code, message } = error instanceof GitHubError ? githubProblem(error) : groqProblem(error, "reply-failed");
  return { error: { code, message } };
}

/**
 * Turn a failed Groq call into a clear response. `code` is what to report when the
 * failure isn't one of the special cases (bad key, rate limit, terms not accepted).
 */
export function groqFailure(error: unknown, code: VoiceErrorCode, label: string): Response {
  console.error(`[${label}]`, error instanceof Error ? error.message : error);
  const problem = groqProblem(error, code);
  return fail(problem.status, problem.code, problem.message, problem.headers);
}

/**
 * Turn a failed "create issue" into a clear response. For a write, GitHub's 403 means
 * "your token may read here but not write", so it gets its own message.
 */
export function issueFailure(error: unknown, repo: string): Response {
  console.error("[issues]", error instanceof Error ? error.message : error);
  const name = repo.split("/")[1] ?? repo;
  if (error instanceof GitHubError && error.kind !== "token" && error.kind !== "rate-limited") {
    if (error.status === 403) {
      return fail(
        403,
        "github-permission",
        `Your token can't create issues in ${name}. Give it Issues: Read and write for this repo.`,
      );
    }
    if (error.status === 404) return fail(404, "github-not-found", `Couldn't find ${name}, or your token can't see it.`);
    if (error.status === 410) return fail(403, "github-permission", `Issues are turned off for ${name}.`);
    if (error.status === 422) return fail(400, "server", "GitHub didn't accept this issue. Check the title and body.");
  }
  const problem = error instanceof GitHubError ? githubProblem(error) : null;
  if (problem) return fail(problem.status, problem.code, problem.message, problem.headers);
  return fail(502, "server", "Couldn't reach GitHub. Try again.");
}

function githubProblem(error: GitHubError): Problem {
  if (error.kind === "token") {
    // Missing token: say how to add it (status 0 = GitHub was never asked). Rejected: say so.
    const missing = error.status === 0;
    return {
      status: 502,
      code: "github-token",
      message: missing ? error.message : "GitHub rejected the token. Check GITHUB_TOKEN in .env.local.",
    };
  }
  if (error.kind === "rate-limited") {
    const minutes = error.retryMinutes ?? 1;
    return {
      status: 429,
      code: "github-rate-limited",
      message: `GitHub's usage limit was reached. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      headers: { "Retry-After": String(minutes * 60) },
    };
  }
  return { status: 502, code: "reply-failed", message: "Couldn't reach GitHub. Try again." };
}

function groqProblem(error: unknown, code: VoiceErrorCode): Problem {
  if (!(error instanceof GroqError)) return { status: 502, code, message: defaultMessage(code) };

  if (error.status === 401) {
    return { status: 502, code: "server", message: "Groq rejected the API key. Check GROQ_API_KEY in .env.local." };
  }
  if (error.status === 429) {
    const wait = error.retryAfter;
    const when = wait ? `in ${Math.ceil(wait)} seconds` : "in a minute";
    return {
      status: 429,
      code: "rate-limited",
      message: `Groq's usage limit was reached. Try again ${when}.`,
      headers: { "Retry-After": String(Math.ceil(wait ?? 60)) },
    };
  }
  if (error.groqCode === "model_terms_required") {
    return {
      status: 403,
      code,
      message:
        "Groq's voice needs a one-time approval: accept the Orpheus terms at console.groq.com (Playground → canopylabs/orpheus-v1-english).",
    };
  }
  return { status: 502, code, message: defaultMessage(code) };
}
