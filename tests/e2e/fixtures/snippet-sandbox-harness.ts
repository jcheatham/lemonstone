// E2E test fixture for the snippet sandbox (SnippetSandbox). Served at
// /tests/e2e/fixtures/snippet-sandbox-harness.html by `npm run dev`; NOT a
// build input, so it never ships. Driven by tests/e2e/snippet-sandbox.spec.ts.
// See docs/snippets.md.

import { SnippetSandbox } from "../../../src/snippet/snippet-sandbox.ts";

// A "secret" on the top window + real storage, so the isolation probe has
// something concrete to fail to reach.
(window as unknown as { SECRET_TOKEN: string }).SECRET_TOKEN = "ghp_topsecret_do_not_leak";
try { localStorage.setItem("ls-secret", "top-secret"); } catch { /* ignore */ }

const log = document.getElementById("log")!;
function line(text: string, cls = ""): void {
  const div = document.createElement("div");
  div.className = "row " + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

const sandbox = new SnippetSandbox(document.getElementById("frame-host")!, {
  onReady: () => line("● host ready", "meta"),
  onHeight: (px) => {
    sandbox.element.style.height = px + "px";
    line(`↕ height ${px}px`, "meta");
  },
  onConsole: (e) => line(`console.${e.level}: ${e.args.join(" ")}`, e.level),
  onDiagnostic: (e) =>
    line(`⚠ ${e.kind}: ${e.message}${e.detail ? " — " + e.detail : ""}`, "diag"),
});

const TOOL = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font:14px system-ui;padding:16px}button{font:inherit;padding:6px 12px}</style></head>
<body>
<h3>Password generator (self-contained)</h3>
<output id="out">—</output><br><br>
<button id="go">Generate</button>
<script>
  console.log("tool booted; crypto?", typeof crypto.getRandomValues === "function");
  document.getElementById("go").addEventListener("click", function(){
    var a = new Uint8Array(12); crypto.getRandomValues(a);
    var s = Array.from(a, function(b){ return b.toString(36); }).join("").slice(0,16);
    document.getElementById("out").textContent = s;
    console.log("generated", s);
  });
<\/script>
</body></html>`;

const EXTERNAL_SCRIPT = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><p>tries to load an external script (should be CSP-blocked)</p>
<script src="https://cdn.jsdelivr.net/npm/left-pad/index.js"><\/script>
</body></html>`;

const FETCH = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><p>tries fetch() to api.github.com</p>
<script>
  fetch("https://api.github.com/zen")
    .then(function(r){ return r.text(); })
    .then(function(t){ console.log("fetch ok:", t); })
    .catch(function(e){ console.error("fetch failed:", e && e.message); });
<\/script></body></html>`;

const PROBE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><p>isolation probe</p>
<script>
  function tryIt(label, fn){ try { console.log(label, "=>", String(fn())); } catch(e){ console.error(label, "BLOCKED:", e && e.message); } }
  tryIt("parent.SECRET_TOKEN", function(){ return parent.SECRET_TOKEN; });
  tryIt("top.SECRET_TOKEN", function(){ return top.SECRET_TOKEN; });
  tryIt("localStorage", function(){ return localStorage.getItem("ls-secret"); });
  tryIt("indexedDB", function(){ return String(indexedDB); });
  tryIt("document.cookie", function(){ return document.cookie; });
<\/script></body></html>`;

function run(label: string, html: string, connectSrc: string[] = []): void {
  line(`\n▶ ${label}`, "meta");
  sandbox.render(html, connectSrc);
}

document.getElementById("btn-tool")!.addEventListener("click", () => run("tool", TOOL));
document.getElementById("btn-ext")!.addEventListener("click", () => run("external-script", EXTERNAL_SCRIPT));
document.getElementById("btn-fetch-deny")!.addEventListener("click", () => run("fetch (no grant)", FETCH));
document.getElementById("btn-fetch-allow")!.addEventListener("click", () =>
  run("fetch (granted github)", FETCH, ["https://api.github.com"]));
document.getElementById("btn-probe")!.addEventListener("click", () => run("isolation probe", PROBE));
