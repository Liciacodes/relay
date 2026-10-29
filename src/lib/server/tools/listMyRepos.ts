import "server-only";

import { clampLimit, githubGet, short } from "../github";
import type { Tool } from "./types";

// Only the fields we use. GitHub sends many more; we drop them to keep results small.
interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  pushed_at: string;
  html_url: string;
}

export const listMyRepos: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_my_repos",
      description: "List the user's GitHub repositories, most recently updated first.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "How many repos to return (1 to 20, default 10)." },
        },
      },
    },
  },

  async run(args) {
    const repos = await githubGet<GitHubRepo[]>("/user/repos", {
      sort: "updated",
      per_page: clampLimit(args.limit),
    });
    return {
      count: repos.length,
      repos: repos.map((repo) => ({
        name: repo.name,
        fullName: repo.full_name,
        description: short(repo.description),
        private: repo.private,
        language: repo.language,
        lastPush: repo.pushed_at,
        url: repo.html_url,
      })),
    };
  },
};
