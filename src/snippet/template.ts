// Starter scaffold for a new snippet. A blank file is a poor start for a format
// with required structure, so we seed a valid document that also documents the
// network-opt-in mechanism (commented out). See docs/snippets.md.

export function snippetTemplate(title: string): string {
  const t = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${t}</title>
  <!-- Network is off by default. To request it, declare the origins here and
       grant them when Lemonstone prompts. Example:
  <meta name="lemonstone-connect-src" content="https://api.example.com"> -->
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 1.5rem; color: #111; }
  </style>
</head>
<body>
  <h1>${t}</h1>
  <p>Edit the source, then Run.</p>
  <script>
    // Your JavaScript runs here, sandboxed. console.log is captured below.
    console.log(${JSON.stringify(title)}, "loaded");
  <\/script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
