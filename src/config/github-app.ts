export const GITHUB_API_BASE = "https://api.github.com";

// CORS proxy required for browser-based git operations. GitHub's git endpoints
// don't set Access-Control-Allow-Origin. Self-hosters can override at build time:
//   LEMONSTONE_CORS_PROXY=https://my-proxy.example.com npm run build
export const GIT_CORS_PROXY: string =
  (import.meta.env["LEMONSTONE_CORS_PROXY"] as string | undefined) ??
  "https://cors.isomorphic-git.org";
