import { defineConfig } from "vite";

export default defineConfig({
  base: process.env["GITHUB_ACTIONS"] ? "/lemonstone/" : "/",
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
