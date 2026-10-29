import "server-only";

import { clampLimit, githubGet, repoPath, short } from "../github";
import type { Tool } from "./types";

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  created_at: string;
  merged_at: string | null;
  user: { login: string } | null;
}

export const pullRequests: Tool = {
  definition: {
    type: "function",
    function: {
      name: "pull_requests",
      description: "Pull requests for a repository: open ones, or recently merged ones. Most recently updated first.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: 'Repo name like "relay", or "owner/relay" for someone else\'s.' },
          state: { type: "string", enum: ["open", "merged"], description: 'Which pull requests (default "open").' },
          limit: { type: "integer", description: "How many to return (1 to 20, default 10)." },
        },
        required: ["repo"],
      },
    },
  },

  async run(args) {
    // 1. Check the inputs. The repo name becomes part of a URL, so repoPath() validates it.
    const { fullName, path } = await repoPath(args.repo);
    const merged = args.state === "merged";
    const limit = clampLimit(args.limit);

    // 2. Ask GitHub. It has no "merged" filter: merged PRs are closed PRs with a merged_at date.
    //    We fetch a few extra closed ones because some were closed without merging.
    const pulls = await githubGet<GitHubPull[]>(`${path}/pulls`, {
      state: merged ? "closed" : "open",
      sort: "updated",
      direction: "desc",
      per_page: merged ? Math.min(limit * 3, 100) : limit,
    });
    const picked = (merged ? pulls.filter((pr) => pr.merged_at) : pulls).slice(0, limit);

    // 3. Keep only what the model needs, plus the GitHub URL (evidence for Day 4).
    return {
      repo: fullName,
      state: merged ? "merged" : "open",
      count: picked.length,
      pullRequests: picked.map((pr) => ({
        number: pr.number,
        title: short(pr.title),
        author: pr.user?.login ?? "unknown",
        draft: pr.draft,
        opened: pr.created_at,
        merged: pr.merged_at ?? undefined,
        url: pr.html_url,
      })),
    };
  },
};
