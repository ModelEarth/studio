import type { Env } from "./env";

const USER_AGENT = "studio-crew";

export interface GitHubIssue {
  title: string;
  html_url: string;
  state: string;
  number: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export function parseRepo(value: string | null): string | null {
  return value && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null;
}

export function parseIssueNumber(value: string | null): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 10_000_000 ? number : null;
}

export async function fetchIssue(env: Env, repo: string, issueNumber: number): Promise<GitHubIssue | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    headers,
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) return null;
  const issue = await response.json<GitHubIssue & { pull_request?: unknown }>();
  if (issue.pull_request) return null;
  return { title: issue.title, html_url: issue.html_url, state: issue.state, number: issue.number };
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    state,
    scope: "read:user",
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForUser(env: Env, code: string, redirectUri: string): Promise<GitHubUser> {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = await tokenResponse.json<{ access_token?: string; error_description?: string }>();
  if (!token.access_token) throw new Error(`GitHub sign-in failed: ${token.error_description ?? tokenResponse.status}`);

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`, "User-Agent": USER_AGENT },
  });
  if (!userResponse.ok) throw new Error(`GitHub user lookup failed: ${userResponse.status}`);
  const user = await userResponse.json<GitHubUser>();
  return { id: user.id, login: user.login, name: user.name, avatar_url: user.avatar_url };
}
