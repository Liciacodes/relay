import "server-only";

import type { ToolStep } from "@/lib/evidence";
import { GitHubError } from "../github";
import { listMyRepos } from "./listMyRepos";
import { openIssues } from "./openIssues";
import { pullRequests } from "./pullRequests";
import { recentCommits } from "./recentCommits";
import type { Tool, ToolResult } from "./types";

const ALL: Tool[] = [listMyRepos, recentCommits, pullRequests, openIssues];

/** The menu sent to the model with every question. */
export const TOOLS = ALL.map((tool) => tool.definition);

/** What the timeline says a tool did, e.g. "Checked commits in reviewpal". */
const LABELS: Record<string, (repo: string) => string> = {
  list_my_repos: () => "Listed your repos",
  recent_commits: (repo) => `Checked commits in ${repo}`,
  pull_requests: (repo) => `Checked pull requests in ${repo}`,
  open_issues: (repo) => `Checked open issues in ${repo}`,
};

export interface ToolRun {
  /** The result as JSON text, sent back to the model. */
  json: string;
  /** The same result as an object, for the evidence cards. */
  result: ToolResult;
  /** For the timeline: what happened and how long it took. */
  step: ToolStep;
}

/**
 * Run the tool the model asked for.
 * Mistakes the model can fix (unknown tool, bad input, repo not found) go back to it as
 * `{ error }`. Problems only you can fix (token, rate limit, GitHub down) are thrown.
 */
export async function runTool(name: string, rawArgs: string): Promise<ToolRun> {
  const started = performance.now();
  let args: Record<string, unknown> = {};
  let result: ToolResult;
  let notFound = false;

  try {
    const tool = ALL.find((t) => t.definition.function.name === name);
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    if (!tool) {
      result = { error: `There is no tool called ${name}.` };
    } else if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      result = { error: "Tool inputs must be a JSON object." };
    } else {
      args = parsed as Record<string, unknown>;
      result = await tool.run(args);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      result = { error: "Tool inputs weren't valid JSON." };
    } else if (error instanceof GitHubError && error.kind === "not-found") {
      notFound = true;
      result = { error: "No repo by that name that this token can see. Check the name, or list the repos." };
    } else {
      throw error;
    }
  }

  const ms = Math.round(performance.now() - started);
  const ok = !("error" in result);
  const repo = typeof args.repo === "string" ? args.repo.trim().slice(0, 60) : "a repo";
  const label = notFound
    ? `Couldn't find ${repo}`
    : (LABELS[name]?.(repo) ?? `Ran ${name}`) + (ok ? "" : " (failed)");

  // So you can watch what the model asked for, in the terminal running `npm run dev`.
  const outcome = ok ? `${String(result.count)} items` : `error: ${String(result.error)}`;
  console.log(`[tool] ${name} ${rawArgs || "{}"} → ${outcome} (${ms}ms)`);

  return { json: JSON.stringify(result), result, step: { label, ms, ok } };
}
