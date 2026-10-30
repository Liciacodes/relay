// Creating an issue: the rules a draft must follow, shared by the server (the propose_issue
// tool and the /api/issues route) and the browser, so both sides agree. No secrets here.

import { VoiceError, errorFromResponse } from "./audio/errors";
import type { Evidence } from "./evidence";

export const TITLE_MAX = 120;
export const BODY_MAX = 1500;

/** An issue Relay has drafted. Nothing exists on GitHub until you press Confirm. */
export interface IssueDraft {
  /** "owner/name". */
  repo: string;
  title: string;
  body: string;
}

const FULL_REPO = /^[\w.-]+\/[\w.-]+$/;

/** What's wrong with this draft, in a short sentence, or null if it's fine. */
export function checkDraft(draft: { repo?: unknown; title?: unknown; body?: unknown }): string | null {
  const { repo, title, body = "" } = draft;
  // "." and ".." are rejected too: in a URL they mean "this folder" and "the folder above".
  if (typeof repo !== "string" || !FULL_REPO.test(repo) || repo.split("/").some((part) => /^\.+$/.test(part))) {
    return "The repo must look like owner/name.";
  }
  if (typeof title !== "string" || !title.trim()) return "The issue needs a title.";
  if (title.length > TITLE_MAX) return `The title must be at most ${TITLE_MAX} characters.`;
  if (/[\r\n]/.test(title)) return "The title must be one line.";
  if (typeof body !== "string") return "The body must be text.";
  if (body.length > BODY_MAX) return `The body must be at most ${BODY_MAX} characters.`;
  return null;
}

/** Browser side: create the confirmed issue. Returns it as an evidence card. */
export async function createIssue(draft: IssueDraft): Promise<Evidence> {
  let response: Response;
  try {
    response = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new VoiceError("network");
  }
  if (!response.ok) throw await errorFromResponse(response, "server");
  const data = (await response.json()) as { issue: Evidence };
  return data.issue;
}
