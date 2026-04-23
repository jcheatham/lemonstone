import { openDB, type IDBPDatabase } from "idb";
import type { LemonstoneDB } from "./schema.ts";

const DB_VERSION = 2;

// Cache one IDB connection per database name. Multi-vault installs can have
// several open at once (though in practice only the current vault's is in
// use); sharing one `dbPromise` per name avoids re-open overhead.
const dbPromises = new Map<string, Promise<IDBPDatabase<LemonstoneDB>>>();

export function getDB(dbName: string): Promise<IDBPDatabase<LemonstoneDB>> {
  let promise = dbPromises.get(dbName);
  if (!promise) {
    promise = openDB<LemonstoneDB>(dbName, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("auth", { keyPath: "key" });

          const notes = db.createObjectStore("notes", { keyPath: "path" });
          notes.createIndex("updatedAt", "updatedAt");
          notes.createIndex("sha", "baseSha");

          db.createObjectStore("canvas", { keyPath: "path" });
          db.createObjectStore("attachments", { keyPath: "path" });
          db.createObjectStore("indexes-snapshot", { keyPath: "key" });
          db.createObjectStore("config", { keyPath: "key" });
        }
        if (oldVersion < 1) {
          /* schema-v1 only — no-op here */
        }
        if (oldVersion < 2) {
          // v2: explicit deletion tombstones. Required so sync only removes
          // files the user intentionally deleted, not files missing from a
          // stale local IndexedDB snapshot.
          db.createObjectStore("tombstones", { keyPath: "path" });
        }
      },
    });
    dbPromises.set(dbName, promise);
  }
  return promise;
}

/** Forget the cached connection for a vault (e.g., before deleteDatabase). */
export function forgetDB(dbName: string): void {
  const p = dbPromises.get(dbName);
  if (p) p.then((db) => db.close()).catch(() => { /* already closed */ });
  dbPromises.delete(dbName);
}
