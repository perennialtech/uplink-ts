import type { GameEvent } from "../engine";

/**
 * Zero-asset Web Audio synthesizer for retro terminal feedback.
 * Unlocks cleanly on first user interaction.
 */
export class SoundSynth {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  beep(freqHz: number, durationSec: number, type: OscillatorType = "sine", gainVal = 0.06): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  }

  handleEvent(event: GameEvent): void {
    switch (event.type) {
      case "connection.opened":
        this.beep(520, 0.08, "triangle");
        break;
      case "connection.closed":
        this.beep(280, 0.08, "triangle");
        break;
      case "auth.succeeded":
        this.beep(660, 0.07, "sine");
        setTimeout(() => this.beep(880, 0.1, "sine"), 75);
        break;
      case "trace.started":
        this.beep(440, 0.14, "sawtooth", 0.05);
        break;
      case "trace.hop":
        this.beep(780 - Math.min(event.hopsRemaining, 6) * 60, 0.09, "square", 0.04);
        break;
      case "task.completed":
        this.beep(740, 0.08, "sine");
        break;
      case "mission.completed":
        this.beep(587, 0.08, "triangle");
        setTimeout(() => this.beep(880, 0.14, "triangle"), 90);
        break;
      case "player.disavowed":
        this.beep(160, 0.45, "sawtooth", 0.09);
        break;
      default:
        break;
    }
  }
}
