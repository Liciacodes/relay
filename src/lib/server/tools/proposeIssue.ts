import "server-only";

import { BODY_MAX, TITLE_MAX, checkDraft } from "@/lib/issues";
import { githubGet, repoPath } from "../github";
import type { Tool } from "./types";

/**
 * Drafts an issue. It does NOT create anything: the draft goes to the browser as a card,
 * and only your Confirm click (→ /api/issues) writes to GitHub.
 */
export const proposeIssue: Tool = {
  definition: {
    type: "function",
    function: {
      name: "propose_issue",
      description:
        "Draft a new issue for the user to check and confirm. It does NOT create anything: the user must press Confirm.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: 'Repo name like "relay", or "owner/relay" for someone else\'s.' },
          title: { type: "string", description: `A short, clear title (at most ${TITLE_MAX} characters).` },
          body: {
            type: "string",
            description: `The details, only from what the user said, without the request itself (no "file an issue in relay:"). At most ${BODY_MAX} characters. Can be empty.`,
          },
        },
        required: ["repo", "title"],
      },
    },
  },

  async run(args) {
    const { fullName, path } = await repoPath(args.repo);
    const draft = {
      repo: fullName,
      title: typeof args.title === "string" ? args.title.trim() : args.title,
      body: typeof args.body === "string" ? args.body.trim() : (args.body ?? ""),
    };
    const problem = checkDraft(draft);
    if (problem) return { error: problem };

    // A GET, so a typo in the repo name shows up now instead of after Confirm.
    const repo = await githubGet<{ has_issues: boolean }>(path);
    if (!repo.has_issues) return { error: `Issues are turned off for ${fullName}.` };

    return {
      count: 1,
      drafted: true,
      ...draft,
      note: "Nothing is created yet. The user must check the draft and press Confirm.",
      say: `I've drafted an issue for ${fullName.split("/")[1]}. Check it and press Confirm.`,
    };
  },
};
