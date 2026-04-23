#!/usr/bin/env node
// lemonstone-decrypt — recover a Lemonstone vault from a git checkout.
//
// Reads .lemonstone/keys.json, determines which zones apply to each file,
// prompts for each zone's passphrase as needed (caching unlocked zones),
// peels off the encryption layers in order, and writes decrypted copies to
// an output directory. Files outside any zone are copied through unchanged.

import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Decrypter } from "age-encryption";

const AGE_MAGIC = "age-encryption.org/v1";
const KEYS_JSON_PATH = ".lemonstone/keys.json";

interface Zone {
  id: string;
  prefix: string;
  algorithm: "age-v1";
  recipient: string;
  wrappedIdentity: string; // base64
}

interface KeysFile {
  version: 1;
  zones: Zone[];
}

function isZone(v: unknown): v is Zone {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    typeof r["prefix"] === "string" &&
    r["algorithm"] === "age-v1" &&
    typeof r["recipient"] === "string" &&
    typeof r["wrappedIdentity"] === "string"
  );
}

function isKeysFile(v: unknown): v is KeysFile {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r["version"] === 1 && Array.isArray(r["zones"]) && r["zones"].every(isZone);
}

function base64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function hasAgeMagic(bytes: Uint8Array): boolean {
  if (bytes.length < AGE_MAGIC.length) return false;
  for (let i = 0; i < AGE_MAGIC.length; i++) {
    if (bytes[i] !== AGE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Zones whose prefix is a prefix of `path`, sorted shortest-first (outermost first).
 *  Decryption order is the reverse: innermost first. */
function applicableZones(filePath: string, zones: Zone[]): Zone[] {
  const out = zones.filter((z) => filePath.startsWith(z.prefix));
  out.sort((a, b) => a.prefix.length - b.prefix.length);
  return out;
}

async function unwrapIdentity(zone: Zone, passphrase: string): Promise<string> {
  const wrapped = base64ToBytes(zone.wrappedIdentity);
  const dec = new Decrypter();
  dec.addPassphrase(passphrase);
  let bytes: Uint8Array;
  try {
    bytes = await dec.decrypt(wrapped);
  } catch (err) {
    throw new Error("wrong passphrase", { cause: err });
  }
  const identity = new TextDecoder().decode(bytes).trim();
  if (!identity.startsWith("AGE-SECRET-KEY-")) {
    throw new Error("wrapped payload is not an age identity");
  }
  return identity;
}

async function promptPassphrase(label: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const stdin = process.stdin;
  if (stdin.isTTY) {
    process.stderr.write(`${label}: `);
    stdin.setRawMode?.(true);
    let buf = "";
    return await new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        const s = chunk.toString("utf8");
        for (const ch of s) {
          if (ch === "\n" || ch === "\r") {
            stdin.setRawMode?.(false);
            stdin.off("data", onData);
            rl.close();
            process.stderr.write("\n");
            resolve(buf);
            return;
          }
          if (ch === "") { process.exit(130); }
          if (ch === "" || ch === "\b") {
            buf = buf.slice(0, -1);
            continue;
          }
          buf += ch;
        }
      };
      stdin.on("data", onData);
    });
  }
  return await new Promise((resolve) => {
    rl.question(`${label}: `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

interface Args {
  repo: string;
  output: string;
  passphraseFile?: string; // JSON: { "<prefix>": "<passphrase>", ... }
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--output" || a === "-o") {
      args.output = argv[++i];
    } else if (a === "--passphrase-file") {
      args.passphraseFile = argv[++i];
    } else if (a.startsWith("--output=")) {
      args.output = a.slice("--output=".length);
    } else if (a.startsWith("--passphrase-file=")) {
      args.passphraseFile = a.slice("--passphrase-file=".length);
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (args.help) return { repo: "", output: "", help: true };
  if (positional.length !== 1) {
    throw new Error("expected exactly one positional argument: <repo-path>");
  }
  return {
    repo: path.resolve(positional[0]!),
    output: path.resolve(
      args.output ??
        path.join(positional[0]!, "..", path.basename(positional[0]!) + "-decrypted"),
    ),
    passphraseFile: args.passphraseFile,
  };
}

const HELP = `lemonstone-decrypt — decrypt a Lemonstone vault checkout.

Usage:
  lemonstone-decrypt <repo-path> [--output <dir>] [--passphrase-file <file>]

Arguments:
  <repo-path>                Path to a cloned Lemonstone vault repo.

Options:
  -o, --output <dir>         Output directory. Default: <repo-path>-decrypted
  --passphrase-file <file>   JSON file mapping zone prefix to passphrase, e.g.
                             { "journal/": "pw1", "work/secrets/": "pw2" }
                             Zones without an entry are prompted interactively.
  -h, --help                 Show this help.

The tool reads <repo-path>/.lemonstone/keys.json, unwraps each zone's identity
as files in that zone are encountered (caching so each passphrase is prompted
at most once), and writes plaintext copies to the output directory. Files
outside any zone are copied unchanged.
`;

async function* walk(dir: string, relPrefix = ""): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".lemonstone") continue;
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs, rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

class ZoneUnlocker {
  private identities = new Map<string, string>(); // zoneId -> identity
  private warnedSkipped = new Set<string>();

  constructor(
    private readonly zones: Zone[],
    private readonly prefixPassphrases: Record<string, string>,
  ) {}

  /** Returns the identity for a zone, unwrapping via prompt or passphrase file. Returns null
   *  if the user skips (ctrl-d / empty passphrase with no file entry). */
  async getIdentity(zoneId: string): Promise<string | null> {
    const cached = this.identities.get(zoneId);
    if (cached) return cached;
    const zone = this.zones.find((z) => z.id === zoneId);
    if (!zone) return null;
    const fromFile = this.prefixPassphrases[zone.prefix];
    if (fromFile !== undefined) {
      try {
        const identity = await unwrapIdentity(zone, fromFile);
        this.identities.set(zoneId, identity);
        return identity;
      } catch (err) {
        process.stderr.write(`ERROR: passphrase for ${zone.prefix} in file did not unwrap: ${(err as Error).message}\n`);
        throw err;
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const pw = await promptPassphrase(`Passphrase for ${zone.prefix}`);
      if (!pw) {
        if (!this.warnedSkipped.has(zoneId)) {
          process.stderr.write(`(skipping zone ${zone.prefix} — files in it will not be decrypted)\n`);
          this.warnedSkipped.add(zoneId);
        }
        return null;
      }
      try {
        const identity = await unwrapIdentity(zone, pw);
        this.identities.set(zoneId, identity);
        return identity;
      } catch {
        process.stderr.write("wrong passphrase — try again.\n");
      }
    }
    process.stderr.write(`Gave up on ${zone.prefix} after 3 attempts.\n`);
    this.warnedSkipped.add(zoneId);
    return null;
  }
}

async function decryptLayered(
  bytes: Uint8Array,
  layers: string[], // decryption order (outermost first)
  unlocker: ZoneUnlocker,
): Promise<Uint8Array | null> {
  let out = bytes;
  for (const zoneId of layers) {
    const identity = await unlocker.getIdentity(zoneId);
    if (!identity) return null;
    const dec = new Decrypter();
    dec.addIdentity(identity);
    out = await dec.decrypt(out);
  }
  return out;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const keysPath = path.join(args.repo, KEYS_JSON_PATH);
  let keysRaw: Buffer;
  try {
    keysRaw = await fs.readFile(keysPath);
  } catch {
    process.stderr.write(`error: ${keysPath} not found. Is this a Lemonstone vault?\n`);
    process.exit(1);
  }
  let keysFile: KeysFile;
  try {
    const parsed = JSON.parse(keysRaw.toString("utf8"));
    if (!isKeysFile(parsed)) throw new Error("malformed keys.json");
    keysFile = parsed;
  } catch (err) {
    process.stderr.write(`error: could not parse keys.json: ${(err as Error).message}\n`);
    process.exit(1);
  }

  let prefixPassphrases: Record<string, string> = {};
  if (args.passphraseFile) {
    try {
      const raw = await fs.readFile(args.passphraseFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      prefixPassphrases = parsed as Record<string, string>;
    } catch (err) {
      process.stderr.write(`error: could not parse --passphrase-file: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const unlocker = new ZoneUnlocker(keysFile.zones, prefixPassphrases);

  await ensureDir(args.output);
  let decrypted = 0;
  let copied = 0;
  let failed = 0;
  let skipped = 0;

  for await (const rel of walk(args.repo)) {
    const src = path.join(args.repo, rel);
    const dst = path.join(args.output, rel);
    await ensureDir(path.dirname(dst));
    const bytes = new Uint8Array(await fs.readFile(src));

    // Prefer the keys.json policy over the magic sniff: if zones apply, the
    // file should be encrypted and we decrypt its layer count accordingly.
    // If bytes don't carry the age magic, fall back to copy.
    const zones = applicableZones(rel, keysFile.zones);
    if (zones.length === 0 || !hasAgeMagic(bytes)) {
      await fs.writeFile(dst, bytes);
      copied++;
      process.stderr.write(`copied:    ${rel}\n`);
      continue;
    }

    // layers are applied outermost-last on write, so decrypt order is the
    // innermost zone first -> outermost zone last. zones[] is sorted
    // shortest-first (outermost first), so reverse for decryption order.
    const decryptOrder = [...zones].reverse().map((z) => z.id);
    try {
      const plain = await decryptLayered(bytes, decryptOrder, unlocker);
      if (plain === null) {
        skipped++;
        process.stderr.write(`skipped:   ${rel} (locked zone)\n`);
        continue;
      }
      await fs.writeFile(dst, plain);
      decrypted++;
      process.stderr.write(`decrypted: ${rel}\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`FAILED:    ${rel} (${(err as Error).message})\n`);
    }
  }

  process.stderr.write(`\nDone. ${decrypted} decrypted, ${copied} copied, ${skipped} skipped, ${failed} failed.\n`);
  process.stderr.write(`Output: ${args.output}\n`);
  if (failed > 0 || skipped > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
