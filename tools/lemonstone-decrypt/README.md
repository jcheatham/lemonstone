# lemonstone-decrypt

Command-line companion to Lemonstone that recovers an encrypted vault without
the browser app. Given a git checkout of a Lemonstone vault and the
passphrase, it writes decrypted copies of every note/canvas/attachment to an
output directory.

## Install

From this directory:

```
npm install
npm run build
npm link        # optional — makes `lemonstone-decrypt` available globally
```

## Usage

```
lemonstone-decrypt <repo-path> [--output <dir>] [--passphrase <p>]
```

If `--passphrase` is omitted the tool prompts on stdin (with echo disabled
when a TTY is attached).

## How it works

1. Reads `<repo-path>/.lemonstone/keys.json`.
2. Uses the passphrase to unwrap the age identity stored inside.
3. Walks the repo (skipping `.git` and `.lemonstone`), and for each file:
   - If it starts with the `age-encryption.org/v1` magic header, decrypts it.
   - Otherwise, copies it through unchanged.

## Threat model

- The passphrase is held in memory only and never written to disk.
- The tool does not write anywhere except the output directory.
- The identity never leaves this process; it is not logged or printed.

## Recovery

This tool is the escape hatch for the "files over app" promise: if the
Lemonstone PWA disappears tomorrow, your content is still recoverable from
the git repo with just this tool and your passphrase.
