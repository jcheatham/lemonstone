import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

function getBuildSha(): string {
  // GitHub Actions sets GITHUB_SHA on every run.
  const envSha = process.env["GITHUB_SHA"];
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

function getBuildRepo(): string {
  // GitHub Actions sets GITHUB_REPOSITORY as "owner/repo".
  const envRepo = process.env["GITHUB_REPOSITORY"];
  if (envRepo) return envRepo;
  try {
    const url = execSync("git config --get remote.origin.url").toString().trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return match[1]!;
  } catch { /* no remote */ }
  return "";
}

export default defineConfig({
  base: process.env["GITHUB_ACTIONS"] ? "/lemonstone/" : "/",
  define: {
    __BUILD_SHA__: JSON.stringify(getBuildSha()),
    __BUILD_REPO__: JSON.stringify(getBuildRepo()),
  },
  resolve: {
    alias: {
      // isomorphic-git's package.json exports map only defines `default: index.cjs`
      // for the main entry, so bundlers get the Node CJS build that uses
      // `crypto.createHash`. Force the ESM build (pure-JS SHA) for browsers.
      "isomorphic-git": fileURLToPath(new URL("./node_modules/isomorphic-git/index.js", import.meta.url)),
    },
  },
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/icon.svg", "icons/lemonstone_128.png"],
      manifest: {
        name: "Lemonstone",
        short_name: "Lemonstone",
        description: "Offline-first Markdown notes backed by your GitHub repository.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#1a1a2e",
        theme_color: "#1a1a2e",
        icons: [
          { src: "icons/lemonstone_192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/lemonstone_512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/lemonstone_512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the build assets + index.html. The worker file is large
        // (isomorphic-git), so bump the limit.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // Don't cache cross-origin git traffic or GitHub API calls — those
        // always need to hit the network and the CORS proxy handles its own.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  worker: {
    format: "es",
  },
});
