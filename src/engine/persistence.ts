import type { WorldState } from "./types";

const STORAGE_KEY = "uplink_ts_save_v1";

export function serializeState(state: Readonly<WorldState>): string {
  return JSON.stringify(state);
}

export function deserializeState(raw: string): WorldState {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw new Error("Unsupported or corrupted save schema");
  }
  return parsed as WorldState;
}

export function saveToBrowser(state: Readonly<WorldState>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, serializeState(state));
}

export function loadFromBrowser(): WorldState | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return deserializeState(raw);
  } catch {
    return null;
  }
}

export function clearBrowserSave(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
