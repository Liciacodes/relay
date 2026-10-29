import "server-only";

import { GitHubError, clampLimit, githubGet, repoPath, short } from "../github";
import type { Tool } from "./types";

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const recentCommits: Tool = {
  definition: {
    type: "function",
    function: {
      name: "recent_commits",
      description: "Recent commits on a repository's default branch, newest first.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: 'Repo name like "relay", or "owner/relay" for someone else\'s.' },
          since: { type: "string", description: "Only commits on or after this date, as YYYY-MM-DD." },
          limit: { type: "integer", description: "How many commits to return (1 to 20, default 10)." },
        },
        required: ["repo"],
      },
    },
  },

  async run(args) {
    const { fullName, path } = await repoPath(args.repo);
    const params: Record<string, string | number> = { per_page: clampLimit(args.limit) };
    if (args.since !== undefined) {
      if (typeof args.since !== "string" || !DATE.test(args.since)) {
        return { error: `"since" must be a date like 2026-10-22, not ${JSON.stringify(args.since)}.` };
      }
      params.since = `${args.since}T00:00:00Z`;
    }

    let commits: GitHubCommit[];
    try {
      commits = await githubGet<GitHubCommit[]>(`${path}/commits`, params);
    } catch (error) {
      // GitHub answers 409 for a repo with no commits yet.
      if (error instanceof GitHubError && error.status === 409) return { repo: fullName, count: 0, commits: [] };
      throw error;
    }

    return {
      repo: fullName,
      count: commits.length,
      commits: commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: short(c.commit.message),
        author: c.author?.login ?? c.commit.author?.name ?? "unknown",
        date: c.commit.author?.date,
        url: c.html_url,
      })),
    };
  },
};
