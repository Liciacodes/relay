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
const LISTED_MAX = 5; // how many commits the model gets to describe out loud

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

    // Numbered and labelled so the model keeps the order and counts each commit once.
    // (One commit message can list several changes, like "usage limits, install button
    // and privacy page"; the model used to split those into separate commits.)
    const limit = params.per_page as number;
    // A full page means GitHub may have more, so the total becomes "10 or more".
    const cutOff = commits.length === limit;
    // The model only sees the newest few: it can't read out (or miscount) what it never gets.
    const listed = commits.slice(0, LISTED_MAX);
    return {
      repo: fullName,
      count: cutOff ? `${limit} or more` : commits.length,
      ...(cutOff && { sayCount: `at least ${limit}` }),
      ...(listed.length < commits.length && {
        listed: `Only the newest ${listed.length} are listed below. Say the count, describe these ${listed.length}, then offer the rest.`,
      }),
      order: "newest first: commit 1 is the most recent",
      note: "Each item is exactly one commit, even when its message lists several changes.",
      commits: listed.map((c, index) => ({
        n: index + 1,
        sha: c.sha.slice(0, 7),
        message: short(c.commit.message),
        author: c.author?.login ?? c.commit.author?.name ?? "unknown",
        date: c.commit.author?.date,
        url: c.html_url,
      })),
    };
  },
};
