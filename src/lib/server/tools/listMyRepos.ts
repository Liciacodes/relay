import "server-only";

import type { Mode } from "../access";
import { clampLimit, githubGet, repoPath, short } from "../github";
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
/** `list` is filled in once GitHub has answered. */
let cache: { at: number; repos: Promise<GitHubRepo[]>; list: GitHubRepo[] | null } | null = null;

const fresh = () => cache !== null && Date.now() - cache.at < CACHE_MS;
/** The demo only ever sees public repos. */
const visible = (repos: GitHubRepo[], mode: Mode) => (mode === "demo" ? repos.filter((repo) => !repo.private) : repos);

function allRepos(): Promise<GitHubRepo[]> {
  if (!fresh()) {
    const entry: NonNullable<typeof cache> = {
      at: Date.now(),
      repos: githubGet<GitHubRepo[]>("/user/repos", { sort: "pushed", per_page: 20 }),
      list: null,
    };
    cache = entry;
    entry.repos.then(
      (repos) => (entry.list = repos),
      () => cache === entry && (cache = null), // a failure shouldn't be remembered
    );
  }
  return cache!.repos;
}

/**
 * Your 20 most recently pushed repos, newest first (public ones only in the demo). Asked
 * from GitHub at most once every 5 minutes: the system prompt, Whisper's spelling hint
 * and list_my_repos all share it.
 */
export async function myRepos(mode: Mode): Promise<GitHubRepo[]> {
  return visible(await allRepos(), mode);
}

/** Repo names, newest first, only if already fetched: never waits for GitHub. */
export function cachedRepoNames(mode: Mode): string[] {
  return fresh() && cache!.list ? visible(cache!.list, mode).map((repo) => repo.name) : [];
}

const visibility = new Map<string, { at: number; isPublic: boolean }>();

/**
 * Is this repo public? Your own recent repos are checked in the cached list; any other
 * repo is asked from GitHub once (a GET) and remembered for 5 minutes.
 */
export async function isPublicRepo(repo: unknown): Promise<boolean> {
  const { fullName, path } = await repoPath(repo);
  const key = fullName.toLowerCase();
  const own = (await allRepos()).find((r) => r.full_name.toLowerCase() === key);
  if (own) return !own.private;

  const known = visibility.get(key);
  if (known && Date.now() - known.at < CACHE_MS) return known.isPublic;
  const { private: isPrivate } = await githubGet<{ private: boolean }>(path);
  visibility.set(key, { at: Date.now(), isPublic: !isPrivate });
  return !isPrivate;
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

  async run(args, { mode }) {
    const repos = (await myRepos(mode)).slice(0, clampLimit(args.limit));
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
