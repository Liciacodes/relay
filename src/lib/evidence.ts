// Shapes shared by the server (/api/reply) and the browser, so both sides agree.
// Like errors.ts, this file has no secrets and no server-only code.

import type { ApiError } from "./audio/errors";
import type { IssueDraft } from "./issues";

export type EvidenceKind = "commit" | "pr" | "issue" | "repo";

/** One GitHub item a tool returned: what an evidence card shows. */
export interface Evidence {
  kind: EvidenceKind;
  /** Commit message's first line, PR/issue title, or repo name. */
  title: string;
  /** "owner/name". */
  repo: string;
  /** ISO date, e.g. "2026-10-27T14:03:00Z". */
  date: string;
  /** What the date means: "Committed", "Merged", "Opened" or "Pushed". */
  dateLabel: string;
  /** The GitHub page. Opens in a new tab. */
  url: string;
  /** PR or issue number. */
  number?: number;
  /** Short commit sha (7 characters). */
  sha?: string;
}

/** A tool lookup the server ran, and how long it took. */
export interface ToolStep {
  /** e.g. "Checked commits in reviewpal". */
  label: string;
  /** Measured on the server, in milliseconds. */
  ms: number;
  /** false when the lookup failed (e.g. the repo wasn't found). */
  ok: boolean;
}

/**
 * One row of the steps timeline in the browser.
 *   milestone: time since you let go of the button ("First word 2.1s")
 *   tool:      how long that one lookup took ("Checked commits in relay 0.4s")
 */
export interface TimelineStep {
  kind: "milestone" | "tool";
  label: string;
  ms: number;
  ok: boolean;
}

/**
 * /api/reply streams NDJSON: one of these per line, as JSON.
 *   step     a tool finished (arrives live, while Relay is still thinking)
 *   text     a piece of the answer
 *   evidence the cards for this answer, ranked (sent once, at the end, only if a tool ran)
 *   draft    an issue Relay drafted; nothing is created until you press Confirm
 *   error    something failed; the stream ends after this
 */
export type ReplyEvent =
  | ({ type: "step" } & ToolStep)
  | { type: "text"; text: string }
  | { type: "evidence"; items: Evidence[] }
  | { type: "draft"; draft: IssueDraft }
  | ({ type: "error" } & ApiError);
