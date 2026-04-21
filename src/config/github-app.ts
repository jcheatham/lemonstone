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

// CORS proxy required for browser-based git operations. GitHub's git endpoints
// don't set Access-Control-Allow-Origin. Self-hosters can override at build time:
//   LEMONSTONE_CORS_PROXY=https://my-proxy.example.com npm run build
export const GIT_CORS_PROXY: string =
  (import.meta.env["LEMONSTONE_CORS_PROXY"] as string | undefined) ??
  "https://cors.isomorphic-git.org";
