import "server-only";

import type { Evidence } from "@/lib/evidence";
import type { ToolResult } from "./tools/types";

const MAX_CARDS = 6;

// The item shapes our tools return (see tools/*.ts). Every item carries its `url`.
interface RepoItem { name: string; fullName: string; lastPush: string; url: string }
interface CommitItem { sha: string; message: string; date?: string; url: string }
interface PullItem { number: number; title: string; opened: string; merged?: string; url: string }
interface IssueItem { number: number; title: string; opened: string; url: string }

/** Turn one tool's result into evidence cards. Errors and unknown tools give none. */
export function evidenceFrom(toolName: string, result: ToolResult): Evidence[] {
  if ("error" in result) return [];
  const repo = typeof result.repo === "string" ? result.repo : "";

  switch (toolName) {
    case "list_my_repos":
      return ((result.repos ?? []) as RepoItem[]).map((r) => ({
        kind: "repo",
        title: r.name,
        repo: r.fullName,
        date: r.lastPush,
        dateLabel: "Pushed",
        url: r.url,
      }));
    case "recent_commits":
      return ((result.commits ?? []) as CommitItem[]).map((c) => ({
        kind: "commit",
        title: c.message,
        repo,
        date: c.date ?? "",
        dateLabel: "Committed",
        url: c.url,
        sha: c.sha,
      }));
    case "pull_requests":
      return ((result.pullRequests ?? []) as PullItem[]).map((pr) => ({
        kind: "pr",
        title: pr.title,
        repo,
        date: pr.merged ?? pr.opened,
        dateLabel: pr.merged ? "Merged" : "Opened",
        url: pr.url,
        number: pr.number,
      }));
    case "open_issues":
      return ((result.issues ?? []) as IssueItem[]).map((issue) => ({
        kind: "issue",
        title: issue.title,
        repo,
        date: issue.opened,
        dateLabel: "Opened",
        url: issue.url,
        number: issue.number,
      }));
    default:
      return [];
  }
}

/** Lowercase, with fancy hyphens (the model likes "‑", U+2011) turned into plain "-". */
const plain = (text: string) => text.toLowerCase().replace(/[‐-―]/g, "-");

/** Does the spoken answer mention this item? Simple text checks, nothing clever. */
function mentioned(item: Evidence, answer: string): boolean {
  const text = plain(answer);
  if (item.kind === "repo") return text.includes(plain(item.title));
  // "#12", "number 12", "pull request 12", "issue 12" (but not "12 commits").
  if (item.number !== undefined && new RegExp(`(#|number |request |issue )${item.number}\\b`).test(text)) {
    return true;
  }
  // The first three words of the title, e.g. "fix singular wording".
  const start = plain(item.title).split(/\s+/).slice(0, 3).join(" ");
  return start.length >= 8 && text.includes(start);
}

/** One tool run's cards, and whether the tool worked. */
export interface Lookup {
  tool: string;
  ok: boolean;
  items: Evidence[];
}

/**
 * Pick the cards to show, most relevant first:
 *   0. repo cards only when listing repos WAS the answer: if any other tool worked, the
 *      repo list was just a helper step (to find a name), so its cards are dropped
 *   1. items the answer mentions
 *   2. then the LAST lookup first
 *   3. within one lookup, GitHub's own order (newest first)
 * Duplicates (same url) are dropped, and at most 6 are kept.
 * `lookups` is in the order the tools ran.
 */
export function rankEvidence(lookups: Lookup[], answer: string): Evidence[] {
  const otherToolWorked = lookups.some((l) => l.ok && l.tool !== "list_my_repos");
  const kept = otherToolWorked ? lookups.filter((l) => l.tool !== "list_my_repos") : lookups;
  const ordered = [...kept].reverse().flatMap((l) => l.items);
  const seen = new Set<string>();
  const unique = ordered.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)));
  // A stable sort keeps the order above among equals; mentioned items just move up.
  const ranked = unique
    .map((item, index) => ({ item, index, hit: mentioned(item, answer) }))
    .sort((a, b) => Number(b.hit) - Number(a.hit) || a.index - b.index)
    .map(({ item }) => item);
  return ranked.slice(0, MAX_CARDS);
}
