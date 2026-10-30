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

const CACHE_MS = 5 * 60_000; // your repo list rarely changes; 5 minutes is fresh enough
/** `names` is filled in once GitHub has answered. */
let cache: { at: number; repos: Promise<GitHubRepo[]>; names: string[] | null } | null = null;

const fresh = () => cache !== null && Date.now() - cache.at < CACHE_MS;

/**
 * Your 20 most recently pushed repos, newest first. Asked from GitHub at most once every
 * 5 minutes: the system prompt, Whisper's spelling hint and list_my_repos all share it.
 */
export function myRepos(): Promise<GitHubRepo[]> {
  if (!fresh()) {
    const entry: NonNullable<typeof cache> = {
      at: Date.now(),
      repos: githubGet<GitHubRepo[]>("/user/repos", { sort: "pushed", per_page: 20 }),
      names: null,
    };
    cache = entry;
    entry.repos.then(
      (repos) => (entry.names = repos.map((repo) => repo.name)),
      () => cache === entry && (cache = null), // a failure shouldn't be remembered
    );
  }
  return cache!.repos;
}

/** Repo names, newest first, only if already fetched: never waits for GitHub. */
export function cachedRepoNames(): string[] {
  return fresh() ? (cache!.names ?? []) : [];
}

export const listMyRepos: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_my_repos",
      description: "List the user's GitHub repositories, most recently pushed first.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "How many repos to return (1 to 20, default 10)." },
        },
      },
    },
  },

  async run(args) {
    const repos = (await myRepos()).slice(0, clampLimit(args.limit));
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
