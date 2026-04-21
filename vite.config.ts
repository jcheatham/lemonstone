import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

export default defineConfig({
  base: process.env["GITHUB_ACTIONS"] ? "/lemonstone/" : "/",
  define: {
    __BUILD_SHA__: JSON.stringify(getBuildSha()),
  },
  resolve: {
    alias: {
      // isomorphic-git's package.json exports map only defines `default: index.cjs`
      // for the main entry, so bundlers get the Node CJS build that uses
      // `crypto.createHash`. Force the ESM build (pure-JS SHA) for browsers.
      "isomorphic-git": fileURLToPath(new URL("./node_modules/isomorphic-git/index.js", import.meta.url)),
    },
  },
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
