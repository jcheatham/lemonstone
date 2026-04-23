// OPFS filesystem adapter for isomorphic-git.
// Falls back to LightningFS on browsers without OPFS (pre-Firefox 111, pre-Safari 17).
import LightningFS from "@isomorphic-git/lightning-fs";

export interface FsPromises {
  readFile(path: string, opts?: { encoding?: string }): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string, opts?: { mode?: number; encoding?: string }): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, mode?: number): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<StatResult>;
  lstat(path: string): Promise<StatResult>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
}

export interface StatResult {
  type: "file" | "dir";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function fsErr(code: string, msg: string): Error & { code: string } {
  return Object.assign(new Error(msg), { code });
}

function convertOPFSErr(err: unknown, path: string): Error & { code: string } {
  if (err instanceof DOMException) {
    if (err.name === "NotFoundError")
      return fsErr("ENOENT", `ENOENT: no such file or directory, '${path}'`);
    if (err.name === "TypeMismatchError")
      return fsErr("ENOTDIR", `ENOTDIR: not a directory, '${path}'`);
    if (err.name === "NotAllowedError")
      return fsErr("EACCES", `EACCES: permission denied, '${path}'`);
    if (err.name === "InvalidStateError")
      return fsErr("ENOENT", `ENOENT: '${path}'`);
  }
  return fsErr("EIO", `EIO: ${String(err)}, '${path}'`);
}

function pathParts(p: string): string[] {
  // Filter both empty segments (from "//") and single-dot segments (from "/./").
  // isomorphic-git builds paths as join(dir, filepath); with dir="/" this produces
  // "//." for the working-tree root, which must reduce to [] (= root).
  return p.split("/").filter(s => s.length > 0 && s !== ".");
}

class OPFSAdapter {
  private root!: FileSystemDirectoryHandle;

  constructor(private readonly dirName: string) {}

  async init(): Promise<void> {
    const storageRoot = await navigator.storage.getDirectory();
    this.root = await storageRoot.getDirectoryHandle(this.dirName, {
      create: true,
    });
  }

  private async navToParent(
    path: string,
    createDirs = false
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = pathParts(path);
    if (parts.length === 0) throw fsErr("EINVAL", `Invalid path: '${path}'`);
    let dir = this.root;
    for (const part of parts.slice(0, -1)) {
      try {
        dir = await dir.getDirectoryHandle(part, { create: createDirs });
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
    }
    return [dir, parts[parts.length - 1]!];
  }

  private async navToDir(path: string): Promise<FileSystemDirectoryHandle> {
    const parts = pathParts(path);
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
    }
    return dir;
  }

  readonly promises: FsPromises = {
    readFile: async (path, opts) => {
      const [dir, name] = await this.navToParent(path);
      let fh: FileSystemFileHandle;
      try {
        fh = await dir.getFileHandle(name);
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
      const file = await fh.getFile();
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (opts?.encoding === "utf8" || opts?.encoding === "utf-8") {
        return new TextDecoder().decode(bytes);
      }
      return bytes;
    },

    writeFile: async (path, data) => {
      const [dir, name] = await this.navToParent(path, true);
      let fh: FileSystemFileHandle;
      try {
        fh = await dir.getFileHandle(name, { create: true });
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
      const writable = await fh.createWritable();
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      await writable.write(bytes);
      await writable.close();
    },

    unlink: async (path) => {
      const [dir, name] = await this.navToParent(path);
      try {
        await dir.removeEntry(name);
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
    },

    readdir: async (path) => {
      let dir: FileSystemDirectoryHandle;
      if (!path || pathParts(path).length === 0) {
        dir = this.root;
      } else {
        try {
          dir = await this.navToDir(path);
        } catch (e) {
          throw convertOPFSErr(e, path);
        }
      }
      const names: string[] = [];
      // OPFS dir[Symbol.asyncIterator] yields [name, handle] tuples.
      // Cast needed until TS DOM lib fully types OPFS async iteration.
      for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        names.push(name);
      }
      return names;
    },

    mkdir: async (path) => {
      if (!path || pathParts(path).length === 0) return;
      const [dir, name] = await this.navToParent(path, true);
      try {
        await dir.getDirectoryHandle(name, { create: true });
      } catch (e) {
        if (e instanceof DOMException && e.name === "TypeMismatchError")
          throw fsErr("EEXIST", `EEXIST: file exists, mkdir '${path}'`);
        throw convertOPFSErr(e, path);
      }
    },

    rmdir: async (path) => {
      if (!path || pathParts(path).length === 0) return;
      const [dir, name] = await this.navToParent(path);
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
    },

    stat: async (path) => {
      if (!path || pathParts(path).length === 0) {
        return dirStat(Date.now());
      }
      const [dir, name] = await this.navToParent(path);
      // Try file first, then directory.
      try {
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        return fileStat(file.size, file.lastModified);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "TypeMismatchError")) {
          throw convertOPFSErr(e, path);
        }
      }
      try {
        await dir.getDirectoryHandle(name);
        return dirStat(Date.now());
      } catch (e) {
        throw convertOPFSErr(e, path);
      }
    },

    lstat: async (path) => {
      // OPFS has no symlinks; lstat === stat.
      return this.promises.stat(path) as Promise<StatResult>;
    },

    readlink: async (path) => {
      // OPFS has no symlinks; read as regular file.
      const data = await this.promises.readFile(path, { encoding: "utf8" });
      return data as string;
    },

    symlink: async (target, path) => {
      // OPFS has no symlinks; write target path as file content.
      await this.promises.writeFile(path, target);
    },
  };
}

function fileStat(size: number, mtimeMs: number): StatResult {
  return {
    type: "file",
    mode: 0o100644,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
}

function dirStat(mtimeMs: number): StatResult {
  return {
    type: "dir",
    mode: 0o040000,
    size: 0,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

export type GitFS = { promises: FsPromises };

export async function createGitFS(dirName: string): Promise<GitFS> {
  if (typeof navigator?.storage?.getDirectory === "function") {
    const adapter = new OPFSAdapter(dirName);
    await adapter.init();
    return adapter;
  }
  // LightningFS fallback for browsers without OPFS.
  return new LightningFS(dirName) as unknown as GitFS;
}
