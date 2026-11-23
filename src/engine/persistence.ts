import type { WorldState } from "./types";

const STORAGE_KEY = "uplink_ts_save_v2";
const IDB_NAME = "uplink_ts_db";
const IDB_STORE = "saves";

export function serializeState(state: Readonly<WorldState>): string {
  return JSON.stringify(state);
}

export function deserializeState(raw: string): WorldState {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 2
  ) {
    throw new Error("Unsupported or outdated save schema (expected schemaVersion: 2)");
  }
  return parsed as WorldState;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveToSlot(slot: string, state: Readonly<WorldState>): Promise<void> {
  const raw = serializeState(state);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(`${STORAGE_KEY}_${slot}`, raw);
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(raw, slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function loadFromSlot(slot: string): Promise<WorldState | null> {
  const db = await openDb();
  if (db) {
    const raw = await new Promise<string | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(slot);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => resolve(null);
    });
    if (raw) {
      try {
        return deserializeState(raw);
      } catch {
        return null;
      }
    }
  }
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${slot}`);
    if (raw) {
      try {
        return deserializeState(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function clearSlot(slot: string): Promise<void> {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(`${STORAGE_KEY}_${slot}`);
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
