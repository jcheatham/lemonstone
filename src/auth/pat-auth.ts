// PAT-based auth. Validates a GitHub Personal Access Token via api.github.com
// (CORS-enabled) and stores it using the same AuthPayload schema as device flow.

import { saveTokens } from "./token-store.ts";
import type { AuthPayload } from "../storage/schema.ts";
import { GITHUB_API_BASE } from "../config/github-app.ts";

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GitHubRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export async function validatePAT(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 401) throw new Error("Invalid token — check it was copied correctly.");
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<GitHubUser>;
}

export async function fetchRepo(token: string, repoFullName: string): Promise<GitHubRepo> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) throw new Error(`Repository "${repoFullName}" not found or not accessible.`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<GitHubRepo>;
}

export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(`${GITHUB_API_BASE}/user/repos?sort=updated&per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<GitHubRepo[]>;
}

export async function savePATAuth(
  token: string,
  repoFullName: string,
  repoDefaultBranch: string
): Promise<AuthPayload> {
  const payload: AuthPayload = {
    accessToken: token,
    refreshToken: "",
    // PATs don't have OAuth-style expiry; set far future so existing expiry
    // checks never trigger a refresh.
    accessTokenExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    refreshTokenExpiresAt: 0,
    installationId: 0,
    repoFullName,
    repoDefaultBranch,
  };
  await saveTokens(payload);
  return payload;
}
