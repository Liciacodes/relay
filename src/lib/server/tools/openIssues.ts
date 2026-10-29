import "server-only";

import { clampLimit, githubGet, repoPath, short } from "../github";
import type { Tool } from "./types";


interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  comments: number;
  user: { login: string } | null;
  labels: { name: string }[];
  pull_request?: unknown;
}


export const openIssues: Tool = {
  definition: {
    type: "function",
    function: {
      name: "open_issues",
      description: "Open issues for a repository (not pull requests), most recently created first.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: 'Repo name like "relay", or "owner/relay" for someone else\'s.' },
          limit: { type: "integer", description: "How many issues to return (1 to 20, default 10)." },
        },
        required: ["repo"],
      },
    },
  },

  async run(args) {
    const {fullName, path} = await repoPath(args.repo);
    const limit = clampLimit(args.limit);
        const items = await githubGet<GitHubIssue[]>(`${path}/issues`, {
      state: "open",
      per_page: 30,
    });
     const issues = items.filter((item) => !item.pull_request).slice(0, limit);

 return {
      repo: fullName,
      count: issues.length,
      issues: issues.map((issue) => ({
        number: issue.number,
        title: short(issue.title),
        author: issue.user?.login ?? "unknown",
        labels: issue.labels.map((label) => label.name),
        comments: issue.comments,
        opened: issue.created_at,
        url: issue.html_url,
      })),
    };
  },
};
