import "server-only"; // build fails if a browser component ever imports this file

// Everything the GitHub tools share: one read-only request helper, error types and
// small trimming helpers. Only GET requests exist here, so nothing can change on GitHub.
// (The one write in the app, creating a confirmed issue, lives in app/api/issues/route.ts.)

export const GITHUB_BASE = "https://api.github.com";
export const TIMEOUT_MS = 10_000;

/** What went wrong, in the few kinds the rest of the app cares about. */
export type GitHubErrorKind = "token" | "rate-limited" | "not-found" | "failed";

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    detail: string,
    /** GitHub's HTTP status, or 0 if GitHub was never reached. */
    readonly status = 0,
    /** Minutes until GitHub's limit resets (only for "rate-limited"). */
    readonly retryMinutes?: number,
  ) {
    super(detail);
    this.name = "GitHubError";
  }
}

/** The headers every GitHub request needs, including the token. Throws if it's missing. */
export function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubError("token", "GITHUB_TOKEN is missing. Add it to .env.local and restart the dev server.");
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** One authenticated GET to the GitHub API. Returns the parsed JSON. */
export async function githubGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const headers = githubHeaders();
  const url = new URL(`${GITHUB_BASE}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("failed", "Couldn't reach GitHub.");
  }
  if (response.ok) return (await response.json()) as T;
  throw githubErrorFrom(response, path);
}

/** Turn a failed GitHub response into a GitHubError of the right kind. */
export function githubErrorFrom(response: Response, path: string): GitHubError {
  // GitHub signals its limit with 403 or 429. Either `retry-after` (seconds) or
  // `x-ratelimit-reset` (a Unix time in seconds) says when to try again.
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.status === 429 || (response.status === 403 && (remaining === "0" || retryAfter))) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const seconds = retryAfter || (reset ? reset - Date.now() / 1000 : 60);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return new GitHubError("rate-limited", `GitHub limit reached (${response.status})`, response.status, minutes);
  }
  if (response.status === 401) return new GitHubError("token", "GitHub rejected the token (401).", 401);
  // 404, or 403 when the token can't see that repo: both mean "not available to us".
  if (response.status === 404 || response.status === 403) {
    return new GitHubError("not-found", `GitHub ${response.status} for ${path}`, response.status);
  }
  return new GitHubError("failed", `GitHub responded ${response.status} for ${path}`, response.status);
}

let login: Promise<string> | null = null;

/** The username that owns GITHUB_TOKEN. Asked once, then remembered. */
export function myLogin(): Promise<string> {
  if (!login) {
    login = githubGet<{ login: string }>("/user").then((user) => user.login);
    login.catch(() => (login = null)); // a failure shouldn't be remembered
  }
  return login;
}

const REPO_NAME = /^[\w.-]+(\/[\w.-]+)?$/;

/**
 * "relay" → "/repos/<you>/relay", "someone/relay" → "/repos/someone/relay".
 * The name comes from the model, so it's checked before it goes into a URL.
 */
export async function repoPath(repo: unknown): Promise<{ fullName: string; path: string }> {
  const name = typeof repo === "string" ? repo.trim() : "";
  // "." and ".." would change the URL's folder, so they're not names either.
  if (!REPO_NAME.test(name) || name.split("/").some((part) => /^\.+$/.test(part))) {
    throw new GitHubError("not-found", `Not a valid repo name: ${String(repo)}`);
  }
  const fullName = name.includes("/") ? name : `${await myLogin()}/${name}`;
  return { fullName, path: `/repos/${fullName}` };
}

/** Cut text to `max` characters (keeping only the first line), so tool results stay small. */
export function short(text: string | null | undefined, max = 120): string {
  const line = (text ?? "").split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A tool's `limit` input: a whole number between 1 and 20, 10 if not given. */
export function clampLimit(limit: unknown): number {
  const n = Math.round(Number(limit));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 10;
}
