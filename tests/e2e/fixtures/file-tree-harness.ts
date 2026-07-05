// E2E test fixture for <ls-file-tree>'s context menu, "..." row button, and
// drag-to-move. Served at /tests/e2e/fixtures/file-tree-harness.html by
// `npm run dev`; NOT a build input, so it never ships. Driven by
// tests/e2e/file-tree.spec.ts. See src/ui/ls-file-tree.ts and
// src/ui/ls-context-menu.ts.

import "../../../src/ui/ls-file-tree.ts";
import type { LSFileTree } from "../../../src/ui/ls-file-tree.ts";
import type { PaletteCommand } from "../../../src/ui/command-types.ts";

const tree = document.createElement("ls-file-tree") as LSFileTree;
tree.style.cssText = "height:100%;";
document.getElementById("host")!.appendChild(tree);

tree.notes = [
  "inbox.md",
  "projects/lemonstone/todo.md",
  "projects/lemonstone/design.canvas",
  "projects/secret/notes.md",
  "tool.html",
];
tree.zones = [{ prefix: "projects/secret/", unlocked: false }];

const commands: PaletteCommand[] = [
  { id: "move-note", label: "Move file…", category: "file", isApplicable: (t) => t.kind !== "folder" },
  { id: "delete-note", label: "Delete file", category: "file", isApplicable: (t) => t.kind !== "folder" },
  { id: "rename-folder", label: "Rename folder…", category: "folder", isApplicable: (t) => t.kind === "folder" },
  { id: "move-folder", label: "Move folder…", category: "folder", isApplicable: (t) => t.kind === "folder" },
  { id: "delete-folder", label: "Delete folder…", category: "folder", isApplicable: (t) => t.kind === "folder" },
  { id: "encrypt-folder", label: "Encrypt folder…", category: "folder", isApplicable: (t) => t.kind === "folder" },
  { id: "sync", label: "Sync now", category: "vault" },
];
tree.commands = commands;

(window as unknown as { __tree: LSFileTree }).__tree = tree;

const log = document.createElement("div");
log.id = "log";
log.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:#000;color:#0f0;font:11px monospace;padding:4px;max-height:120px;overflow:auto;";
document.body.appendChild(log);
for (const evt of ["file-command", "folder-rename", "file-rename", "file-open", "file-new"]) {
  tree.addEventListener(evt, (e) => {
    const line = document.createElement("div");
    line.textContent = `${evt}: ${JSON.stringify((e as CustomEvent).detail)}`;
    log.appendChild(line);
  });
}
