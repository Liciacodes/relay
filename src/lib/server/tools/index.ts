import "server-only";

import { GitHubError } from "../github";
import { listMyRepos } from "./listMyRepos";
import { openIssues } from "./openIssues";
import { pullRequests } from "./pullRequests";
import { recentCommits } from "./recentCommits";
import type { Tool, ToolResult } from "./types";

const ALL: Tool[] = [listMyRepos, recentCommits, pullRequests, openIssues];

/** The menu sent to the model with every question. */
export const TOOLS = ALL.map((tool) => tool.definition);

/**
 * Run the tool the model asked for and return the JSON text to send back to it.
 * Mistakes the model can fix (unknown tool, bad input, repo not found) go back to it as
 * `{ error }`. Problems only you can fix (token, rate limit, GitHub down) are thrown.
 */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  let result: ToolResult;
  try {
    const tool = ALL.find((t) => t.definition.function.name === name);
    if (!tool) {
      result = { error: `There is no tool called ${name}.` };
    } else {
      const args = JSON.parse(rawArgs || "{}") as unknown;
      result =
        args && typeof args === "object" && !Array.isArray(args)
          ? await tool.run(args as Record<string, unknown>)
          : { error: "Tool inputs must be a JSON object." };
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      result = { error: "Tool inputs weren't valid JSON." };
    } else if (error instanceof GitHubError && error.kind === "not-found") {
      result = { error: "No repo by that name that this token can see. Check the name, or list the repos." };
    } else {
      throw error;
    }
  }

  // So you can watch what the model asked for, in the terminal running `npm run dev`.
  const outcome = "error" in result ? `error: ${String(result.error)}` : `${String(result.count)} items`;
  console.log(`[tool] ${name} ${rawArgs || "{}"} → ${outcome}`);
  return JSON.stringify(result);
}
