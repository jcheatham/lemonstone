import { openDB, type IDBPDatabase } from "idb";
import type { LemonstoneDB } from "./schema.ts";

const DB_NAME = "lemonstone-vault";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LemonstoneDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LemonstoneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LemonstoneDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("auth", { keyPath: "key" });

        const notes = db.createObjectStore("notes", { keyPath: "path" });
        notes.createIndex("updatedAt", "updatedAt");
        notes.createIndex("sha", "baseSha");

        db.createObjectStore("canvas", { keyPath: "path" });
        db.createObjectStore("attachments", { keyPath: "path" });
        db.createObjectStore("indexes-snapshot", { keyPath: "key" });
        db.createObjectStore("config", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}
