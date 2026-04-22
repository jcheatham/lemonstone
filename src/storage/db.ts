import { openDB, type IDBPDatabase } from "idb";
import type { LemonstoneDB } from "./schema.ts";

const DB_NAME = "lemonstone-vault";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<LemonstoneDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LemonstoneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LemonstoneDB>(DB_NAME, DB_VERSION, {
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
        if (oldVersion < 2) {
          // v2: explicit deletion tombstones. Required so sync only removes
          // files the user intentionally deleted, not files missing from a
          // stale local IndexedDB snapshot.
          db.createObjectStore("tombstones", { keyPath: "path" });
        }
      },
    });
  }
  return dbPromise;
}
