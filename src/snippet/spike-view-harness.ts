// DEV-ONLY harness for <ls-snippet>. Served at /spike-snippet-view.html by
// `npm run dev`; not a build input, so it never ships.
import "../ui/ls-snippet.ts";
import type { LSSnippet } from "../ui/ls-snippet.ts";

const el = document.createElement("ls-snippet") as LSSnippet;
el.path = "tools/net.html";
el.grantedOrigins = [];
el.value = `<!doctype html><html><head><meta charset="utf-8">
<meta name="lemonstone-connect-src" content="https://api.github.com">
<style>body{font:15px system-ui;padding:16px}</style></head>
<body><h1>Network demo</h1>
<script>
console.log("net demo loaded");
fetch("https://api.github.com/zen")
  .then(r => r.text())
  .then(t => console.log("FETCH_OK:", t))
  .catch(e => console.error("FETCH_ERR:", e && e.message));
<\/script></body></html>`;

// Simulate ls-app: persist grants in memory and feed them back.
const grants: string[] = [];
el.addEventListener("snippet-grant-request", (e) => {
  const { origins } = (e as CustomEvent<{ origins: string[] }>).detail;
  for (const o of origins) if (!grants.includes(o)) grants.push(o);
  el.grantedOrigins = [...grants];
});

const host = document.getElementById("host")!;
host.appendChild(el);
(window as unknown as { setW: (w: number) => void }).setW = (w) => { host.style.width = w + "px"; };
