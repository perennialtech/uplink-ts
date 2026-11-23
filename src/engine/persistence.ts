import type { WorldState } from "./types";

const DB_NAME = "uplink_ts_saves";
const STORE_NAME = "slots";
const DB_VERSION = 1;

export function serializeState(state: WorldState): string {
  return JSON.stringify(state);
}

export function deserializeState(raw: string): WorldState {
  const parsed = JSON.parse(raw) as Partial<WorldState>;
  if (!parsed || parsed.schemaVersion !== 3 || !parsed.player || !parsed.servers) {
    throw new Error("Invalid or incompatible Uplink-TS save file (expected schema v3).");
  }
  return parsed as WorldState;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

export async function saveToSlot(slotId: string, state: WorldState): Promise<void> {
  const payload = serializeState(state);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(payload, slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    });
    db.close();
  } catch {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`uplink_ts_slot_${slotId}`, payload);
    }
  }
}

export async function loadFromSlot(slotId: string): Promise<WorldState | null> {
  try {
    const db = await openDb();
    const raw = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(slotId);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
    db.close();
    if (raw) {
      return deserializeState(raw);
    }
  } catch {
    // Fallback to localStorage below
  }

  if (typeof localStorage !== "undefined") {
    const fallback = localStorage.getItem(`uplink_ts_slot_${slotId}`);
    if (fallback) {
      try {
        return deserializeState(fallback);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function clearSlot(slotId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
    db.close();
  } catch {
    // ignore
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(`uplink_ts_slot_${slotId}`);
  }
}
