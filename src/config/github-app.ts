// Override this constant at build time for self-hosted deployments:
//   LEMONSTONE_CLIENT_ID=Iv1.xxxx npm run build
export const GITHUB_APP_CLIENT_ID: string =
  (import.meta.env["LEMONSTONE_CLIENT_ID"] as string | undefined) ??
  "PLACEHOLDER_CLIENT_ID";

export const GITHUB_DEVICE_CODE_URL =
  "https://github.com/login/device/code";

export const GITHUB_ACCESS_TOKEN_URL =
  "https://github.com/login/oauth/access_token";

export const GITHUB_API_BASE = "https://api.github.com";
