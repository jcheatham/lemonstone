import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
} from "../config/github-app.ts";
import { saveTokens } from "./token-store.ts";
import type { AuthPayload } from "../storage/schema.ts";

// All GitHub login/* endpoints require form-encoded bodies to avoid a CORS
// preflight OPTIONS request (they don't handle OPTIONS). Accept: application/json
// is a CORS-safelisted header so it doesn't trigger preflight.
function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formBody({ client_id: GITHUB_APP_CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
  const data = await res.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "success"; payload: AuthPayload };

export async function pollForToken(
  deviceCode: string,
  installationId: number,
  repoFullName: string,
  repoDefaultBranch: string
): Promise<PollResult> {
  const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formBody({
      client_id: GITHUB_APP_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = await res.json() as Record<string, unknown>;

  if (data["error"] === "authorization_pending") return { status: "pending" };
  if (data["error"] === "slow_down") return { status: "slow_down" };
  if (data["error"] === "expired_token") return { status: "expired" };
  if (data["error"] === "access_denied") return { status: "denied" };

  if (data["access_token"]) {
    const now = Date.now();
    const payload: AuthPayload = {
      accessToken: data["access_token"] as string,
      refreshToken: data["refresh_token"] as string,
      accessTokenExpiresAt: now + (data["expires_in"] as number) * 1000,
      refreshTokenExpiresAt:
        now + (data["refresh_token_expires_in"] as number) * 1000,
      installationId,
      repoFullName,
      repoDefaultBranch,
    };
    await saveTokens(payload);
    return { status: "success", payload };
  }

  throw new Error(`Unexpected token response: ${JSON.stringify(data)}`);
}

export async function refreshAccessToken(
  currentRefreshToken: string,
  installationId: number,
  repoFullName: string,
  repoDefaultBranch: string
): Promise<AuthPayload> {
  const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formBody({
      client_id: GITHUB_APP_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;

  if (data["error"]) {
    throw new Error(`Refresh error: ${data["error"] as string}`);
  }

  const now = Date.now();
  const payload: AuthPayload = {
    accessToken: data["access_token"] as string,
    refreshToken: data["refresh_token"] as string,
    accessTokenExpiresAt: now + (data["expires_in"] as number) * 1000,
    refreshTokenExpiresAt:
      now + (data["refresh_token_expires_in"] as number) * 1000,
    installationId,
    repoFullName,
    repoDefaultBranch,
  };
  await saveTokens(payload);
  return payload;
}
