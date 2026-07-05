import { defineConfig, type Plugin } from "vite";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build as esbuildBuild } from "esbuild";
import { VitePWA } from "vite-plugin-pwa";

// The snippet sandbox host (sandbox.html) loads at an opaque origin, where a
// `type="module"` script would be CORS-blocked on a static host. So we inline
// the bundled host as a CLASSIC (no-CORS) inline script. The TS source in
// src/snippet stays the single source of truth (and unit-tested); esbuild
// bundles it to an IIFE and this plugin substitutes it for a placeholder in
// sandbox.html — in dev (via middleware) and build (via emitted asset).
async function bundleSandboxHost(): Promise<string> {
  const entry = fileURLToPath(new URL("./src/snippet/sandbox-host.ts", import.meta.url));
  const res = await esbuildBuild({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  });
  return res.outputFiles![0]!.text;
}

function sandboxHostPlugin(): Plugin {
  const PLACEHOLDER = "<!--LEMONSTONE_SANDBOX_HOST-->";
  const htmlPath = fileURLToPath(new URL("./sandbox.html", import.meta.url));
  const inline = async (): Promise<string> => {
    const raw = readFileSync(htmlPath, "utf8");
    const code = await bundleSandboxHost();
    return raw.replace(PLACEHOLDER, `<script>${code}</script>`);
  };
  return {
    name: "lemonstone-sandbox-host",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path && path.endsWith("/sandbox.html")) {
          res.setHeader("Content-Type", "text/html");
          res.end(await inline());
          return;
        }
        next();
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "sandbox.html", source: await inline() });
    },
  };
}

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
    sandboxHostPlugin(),
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
        // When installed, prefer opening in-scope links (including share
        // links like `#/share/<blob>`) in the PWA rather than the browser
        // tab. Supported on Chromium/Android; iOS 16.4+ honors this for
        // home-screen PWAs, older Safari falls back to opening in Safari.
        handle_links: "preferred",
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
        // NOTE: sandbox.html is intentionally NOT a Rollup HTML entry. It is
        // emitted by sandboxHostPlugin() with the host bundled as a classic
        // inline script (opaque-origin module fetches are CORS-blocked).
      },
    },
  },
  worker: {
    format: "es",
  },
});
