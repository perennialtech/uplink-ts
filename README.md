# uplink-ts

A clean-room, modern TypeScript & HTML5 rewrite of the hacking simulation mechanics inspired by Introversion Software's *Uplink* (2001), built from the ground up with **zero legacy C++ debt**.

## Architectural Principles

Legacy 2001 architecture pitfalls intentionally avoided:
- **Zero UI/simulation coupling:** `src/engine/` has **no DOM, Canvas, or Audio imports** and runs completely headless in Node/Vitest or the browser.
- **Deterministic simulation:** All world generation, trace variance, and password cracking use a seeded PRNG (`Mulberry32`) and fixed-timestep `tick(deltaSec)` updates.
- **Versioned JSON state:** Replaces fragile binary C++ `Load`/`Save` streams with a typed `schemaVersion: 1` JSON model persisted in browser storage.
- **Decoupled event bus:** Audio (`Web Audio API`) and UI panels subscribe to typed domain events (`trace.started`, `trace.hop`, `task.completed`, `mission.completed`, `player.disavowed`).
- **Strict TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and zero runtime dependencies.

## Implemented Core Systems

- **Bounce Routing & Active Trace Math (`src/engine/simulation.ts`):** Per-hop trace times scaled by server archetype and player privilege on each bounce node (`0.1x` no account, `0.7x` user, `1.0x` admin, `1.3x` mainframe, `1.6x` bank admin).
- **Cooperative CPU Task Scheduler:** Dynamically distributes total gateway GHz across running tools (`Password Breaker`, `Trace Tracker v1–v4`, `File Copier`, `File Deleter`, `Log Deleter v1–v4`, `Proxy/Firewall Disable & Bypass`, `Monitor Bypass`, `LAN Scan`) with live priority weights.
- **Passive Trace Log Audits:** Disconnecting after an active trace schedules a delayed log audit that walks backward through your bounce chain—defeated only when you cleanly wipe forwarding logs with `Log Deleter v4`.
- **Procedural World & Contracts (`src/engine/worldGen.ts`):** Generates InterNIC, Uplink Internal Services, Test Machine, Banks, Databases, Corporate Servers, a Corporate LAN, and executable contracts with credit payouts and Uplink/Neuromancer ratings.
- **Interactive Canvas Map & Retro Synth (`src/ui/`):** Click-to-bounce global map with animated trace frontier, local gateway dashboard, software/CPU/gateway shop, and zero-asset Web Audio feedback.

## Development

```bash
npm install
npm run dev        # Start local Vite dev server
npm test           # Run Vitest headless simulation tests
npm run typecheck  # Strict TypeScript check
npm run build      # Typecheck + production bundle
```

## Roadmap

- [ ] Full interactive LAN mini-game traversal (locks, auth servers, spoofing, modem dial-in)
- [ ] Bank transfer & criminal/academic/social database editing screens
- [ ] Multi-stage storyline event scripts & rival AI agents
- [ ] IndexedDB multi-slot save manager with JSON import/export
