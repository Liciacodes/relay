// POST /api/issues — runs only on the server, and only when you press Confirm on a draft.
// Gets { repo, title, body }, checks them again (never trusting the browser), creates the
// issue on GitHub, and sends it back as an evidence card: { issue }.
//
// This is the ONLY place in the app that writes to GitHub. Everything else is GET-only.

import type { Evidence } from "@/lib/evidence";
import { checkDraft } from "@/lib/issues";
import { modeOf } from "@/lib/server/access";
import { GITHUB_BASE, GitHubError, TIMEOUT_MS, githubErrorFrom, githubHeaders } from "@/lib/server/github";
import { fail, issueFailure } from "@/lib/server/respond";

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
}

/**
 * Only our own page may call this. A JSON body can't be sent cross-site without the
 * browser asking first (CORS), and if an Origin header is present it must be this site.
 */
function fromOurPage(request: Request): boolean {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // e.g. curl; browsers always send Origin on a POST
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!fromOurPage(request)) return fail(403, "server", "Issues can only be created from Relay's own page.");
  // The public demo is read-only: only the owner (full mode, after the password) can write.
  if (modeOf(request) !== "full") return fail(403, "github-permission", "Creating issues is turned off in the demo.");

  const body = (await request.json().catch(() => null)) as { repo?: unknown; title?: unknown; body?: unknown } | null;
  const problem = checkDraft(body ?? {});
  if (problem) return fail(400, "server", problem);
  const draft = { repo: body!.repo as string, title: (body!.title as string).trim(), body: (body!.body as string) ?? "" };

  try {
    // The one write. POST /repos/{owner}/{repo}/issues creates an issue.
    let response: Response;
    try {
      response = await fetch(`${GITHUB_BASE}/repos/${draft.repo}/issues`, {
        method: "POST",
        headers: { ...githubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, body: draft.body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new GitHubError("failed", "Couldn't reach GitHub.");
    }
    if (!response.ok) throw githubErrorFrom(response, `/repos/${draft.repo}/issues`);

    const created = (await response.json()) as GitHubIssue;
    console.log(`[issues] created ${draft.repo}#${created.number}`);
    const issue: Evidence = {
      kind: "issue",
      title: created.title,
      repo: draft.repo,
      date: created.created_at,
      dateLabel: "Opened",
      url: created.html_url,
      number: created.number,
    };
    return Response.json({ issue });
  } catch (error) {
    return issueFailure(error, draft.repo);
  }
}
