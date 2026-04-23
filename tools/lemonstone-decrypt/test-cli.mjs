// Integration smoke test: build a synthetic vault with two nested zones
// (journal/ and journal/private/), each with its own passphrase, then run
// the CLI against it and verify every file is recovered correctly.

import { Encrypter, generateIdentity, identityToRecipient } from "age-encryption";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const tmpRoot = await fs.mkdtemp("/tmp/ls-decrypt-test-");
const repo = path.join(tmpRoot, "repo");
await fs.mkdir(path.join(repo, ".lemonstone"), { recursive: true });
await fs.mkdir(path.join(repo, "journal/private"), { recursive: true });
await fs.mkdir(path.join(repo, "notes"), { recursive: true });

async function makeZone(prefix, passphrase) {
  const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const wEnc = new Encrypter();
  wEnc.setPassphrase(passphrase);
  const wrapped = await wEnc.encrypt(new TextEncoder().encode(identity));
  return {
    zone: {
      id, prefix, algorithm: "age-v1", recipient,
      wrappedIdentity: Buffer.from(wrapped).toString("base64"),
    },
    identity, recipient,
  };
}

const outer = await makeZone("journal/", "outer-pass-one");
const inner = await makeZone("journal/private/", "inner-pass-two");

await fs.writeFile(
  path.join(repo, ".lemonstone/keys.json"),
  JSON.stringify({ version: 1, zones: [outer.zone, inner.zone] }, null, 2),
);

// Plaintext file (outside any zone).
await fs.writeFile(path.join(repo, "notes/plain.md"), "# Plain notes\n\nRegular content.");

// Single-layer: journal/public.md — encrypted only with outer key.
{
  const enc = new Encrypter();
  enc.addRecipient(outer.recipient);
  const cipher = await enc.encrypt(new TextEncoder().encode("# Journal public\n\nToday I learned..."));
  await fs.writeFile(path.join(repo, "journal/public.md"), cipher);
}

// Double-layer: journal/private/diary.md — outer first, then inner.
{
  const enc1 = new Encrypter();
  enc1.addRecipient(outer.recipient);
  const once = await enc1.encrypt(new TextEncoder().encode("# Secret diary\n\nOnly for my eyes."));
  const enc2 = new Encrypter();
  enc2.addRecipient(inner.recipient);
  const twice = await enc2.encrypt(once);
  await fs.writeFile(path.join(repo, "journal/private/diary.md"), twice);
}

// Passphrase file for non-interactive run.
const pwFile = path.join(tmpRoot, "pw.json");
await fs.writeFile(pwFile, JSON.stringify({
  "journal/": "outer-pass-one",
  "journal/private/": "inner-pass-two",
}));

const output = path.join(tmpRoot, "out");
await new Promise((resolve, reject) => {
  const p = spawn("node", [
    "dist/index.js",
    repo, "--output", output, "--passphrase-file", pwFile,
  ], { stdio: ["ignore", "inherit", "inherit"] });
  p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
});

const plain = await fs.readFile(path.join(output, "notes/plain.md"), "utf8");
const pub = await fs.readFile(path.join(output, "journal/public.md"), "utf8");
const diary = await fs.readFile(path.join(output, "journal/private/diary.md"), "utf8");

if (!plain.includes("Regular content")) throw new Error("plain: " + plain);
if (!pub.includes("Today I learned")) throw new Error("pub: " + pub);
if (!diary.includes("Only for my eyes")) throw new Error("diary: " + diary);

console.log("OK — 3 files recovered (1 plaintext, 1 single-layer, 1 double-layer)");
