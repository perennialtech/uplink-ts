# uplink-ts

A complete, clean-room TypeScript & HTML5 rewrite of the hacking simulation mechanics inspired by Introversion Software's *Uplink* (2001), engineered from scratch with **zero legacy C++ tech debt** and **zero runtime dependencies**.

## Architecture (Zero Legacy Debt)

- **100% Headless Simulation (`src/engine/`):** Pure TypeScript with zero DOM, Canvas, or Web Audio imports. Runs identically in Node/Vitest and browsers on a deterministic fixed-timestep `tick(deltaSec)` clock with a seeded Mulberry32 PRNG.
- **Typed Event Bus (`src/engine/events.ts`):** UI panels and the Web Audio synthesizer subscribe to domain events (`trace.started`, `trace.hop`, `lan.sysadmin_alert`, `task.completed`, `mission.completed`, `story.updated`, `player.disavowed`).
- **Versioned JSON Persistence (`src/engine/persistence.ts`):** Schema-validated (`schemaVersion: 2`) async IndexedDB saves with automatic `localStorage` fallback plus one-click `.json` export/import.
- **Strict TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and automated GitHub Actions CI + GitHub Pages deployment (`.github/workflows/ci.yml`).

## Complete Feature Set

- **Bounce Routing & Active Trace Engine:** Per-hop trace times scaled by server archetype and player privilege (`0.1x` no account, `0.7x` user, `1.0x` admin, `1.3x` mainframe, `1.6x` bank admin) with animated Canvas trace frontier.
- **Cooperative CPU Task Manager:** Dynamic GHz sharing across running tools with live priority weights:
  - `Password Breaker`, `Dictionary Hacker`, `Trace Tracker v1–v4`
  - `File Copier`, `File Deleter`, `Decrypter v1–v5`
  - `Log Deleter v1–v4`, `Log Undeleter`, `Log Modifier`
  - `Proxy / Firewall Disable & Bypass`, `Monitor Bypass`
  - `LAN Scan`, `LAN Probe`, `LAN Spoof`, `LAN Force`
- **Corporate LAN Mini-Game (`src/engine/lan.ts`, `src/ui/lanView.ts`):** Interactive node-by-node Canvas graph traversal (routers, hubs, auth servers, locks, terminals, main servers) with BFS-guided **Sysadmin AI pursuit**.
- **Banks & Financial Audits:** Crack NPC bank accounts, wire funds, and delete **both** outgoing and incoming statements before the scheduled bank audit catches you.
- **Editable Government Databases:** Global Criminal Database (clear records / frame targets), International Academic Database (GPA edits), and Social Security Database.
- **ARC vs. Arunmor Storyline (`src/engine/story.ts`):** Unlocks at Novice rating via the dead agent's email; side with ARC (`Revelation`) or Arunmor (`Faith`) with live Uplink News headlines and dual victory endings.
- **Zero-Asset Web Audio Synth (`src/ui/audio.ts`):** Retro terminal feedback generated via Web Audio oscillators—no copyrighted `.dat` assets required.

## Development

```bash
npm install
npm run dev        # Start local Vite dev server
npm test           # Run Vitest simulation suite
npm run typecheck  # Strict TypeScript check
npm run build      # Typecheck + production bundle
```
