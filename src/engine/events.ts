import type { GameEvent } from "./types";

type Listener = (event: GameEvent) => void;

/**
 * Decoupled pub/sub event bus so UI, audio synth, and logging subscribe to
 * simulation events without leaking DOM/WebAudio code into src/engine/.
 */
export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
