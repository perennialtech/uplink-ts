import type { Mission, WorldState } from "./types";

/** Original data.h REVELATION_RELEASEUNCONTROLLED = 20 (scaled to reachable 5 in compact world, or 6+ servers) */
export const REVELATION_WIN_THRESHOLD = 5;
export const FAITH_WIN_THRESHOLD = 5;

export interface StorySpecialMissionDef {
  code: string;
  faction: "arc" | "arunmor";
  title: string;
  payment: number;
  description: (state: WorldState) => string;
  buildMission: (state: WorldState, id: string) => Mission;
}

/**
 * Evaluates ARC vs. Arunmor storyline progression based on player rating,
 * special mission completions, and deployed Revelation/Faith payloads.
 * Aligned with original PlotGenerator (plotgenerator.h / plotgenerator.cpp).
 */
export function checkStoryTriggers(
  state: WorldState,
  nextId: (prefix: string) => string
): { stageChanged: boolean; headline?: string } {
  // Act 1 -> Act 2: Dead agent warning email when player reaches Novice (score >= 6)
  if (state.story.stage === "dormant" && state.player.uplinkScore >= 6) {
    state.story.stage = "dead_agent_email";
    state.story.act = 1;
    state.story.scene = 7;

    const arc = state.servers[state.story.arcServerIp];
    const arunmor = state.servers[state.story.arunmorServerIp];
    if (arc) arc.discovered = true;
    if (arunmor) arunmor.discovered = true;

    state.emails.unshift({
      id: nextId("email"),
      from: "agent_deadman@uplink.net",
      subject: "WARNING: ARC and Project Revelation",
      body:
        `If you are reading this, I am already dead.\n\n` +
        `I was hired by Andromeda Research Corporation (ARC) at ${state.story.arcServerIp} to work on a classified system weapon called REVELATION. ` +
        `When I discovered what it does, they came for me.\n\n` +
        `Arunmor Corporation (${state.story.arunmorServerIp}) has begun developing a counter-measure called FAITH. ` +
        `Choose your loyalty in the Storyline panel:\n` +
        `• Side with ARC: Receive Revelation v${state.story.revelationVersion.toFixed(1)}, run Maiden Flight / Darwin / The Grand Tour, and push Revelation across ${REVELATION_WIN_THRESHOLD} corporate hosts.\n` +
        `• Side with Arunmor: Receive Faith v${state.story.faithVersion.toFixed(1)}, run Backfire / Tracer / Counterattack, and purge/harden ${FAITH_WIN_THRESHOLD} corporate hosts.`,
      timestampMs: state.timeMs,
      read: false,
    });

    const headline = "Top Uplink Agent Found Dead; Rumors of 'Revelation' Worm Surface";
    state.news.unshift({
      id: nextId("news"),
      timestampMs: state.timeMs,
      headline,
      body: "Federal investigators confirmed the death of a senior freelance agent shortly after he publicly defended Andromeda Research Corporation.",
    });
    return { stageChanged: true, headline };
  }

  // Act 5 Victory / Collapse checks
  if (state.story.stage === "active_war") {
    if (state.story.revelationCount >= REVELATION_WIN_THRESHOLD) {
      state.story.stage = "arc_victory";
      state.story.act = 5;
      state.story.scene = 7;
      const headline = "GLOBAL NET COLLAPSE: ARC's Revelation Reaches Uncontrolled Release";
      state.news.unshift({
        id: nextId("news"),
        timestampMs: state.timeMs,
        headline,
        body: "Critical corporate backbones have succumbed to Revelation. Internet routing tables have collapsed worldwide. ARC declares total victory.",
      });
      return { stageChanged: true, headline };
    }
    if (state.story.faithCount >= FAITH_WIN_THRESHOLD) {
      state.story.stage = "arunmor_victory";
      state.story.act = 6;
      state.story.scene = 2;
      const headline = "ARC BUSTED: Arunmor's Faith Neutralizes Revelation";
      state.news.unshift({
        id: nextId("news"),
        timestampMs: state.timeMs,
        headline,
        body: "Arunmor Corporation confirms Faith has eradicated Revelation. Federal agents raided ARC headquarters and indicted Andromeda leadership.",
      });
      return { stageChanged: true, headline };
    }
  }

  return { stageChanged: false };
}

export function spawnFactionStoryMissions(
  state: WorldState,
  faction: "arc" | "arunmor",
  nextId: (prefix: string) => string
): void {
  const existingCodes = new Set(state.missions.map((m) => m.specialMissionCode).filter(Boolean));
  const targetCorp = Object.values(state.servers).find(
    (s) =>
      (s.kind === "internal_services" || s.kind === "central_mainframe") &&
      s.ip !== state.story.arcServerIp &&
      s.ip !== state.story.arunmorServerIp &&
      !s.destroyed
  );
  if (!targetCorp) return;

  if (faction === "arc") {
    if (!existingCodes.has("MAIDEN_FLIGHT")) {
      state.missions.unshift({
        id: nextId("mission"),
        kind: "story_special",
        specialMissionCode: "MAIDEN_FLIGHT",
        title: "[ARC] Maiden Flight",
        employer: "Andromeda Research Corp",
        description: `Test Revelation v${state.story.revelationVersion.toFixed(1)} in the wild. Gain admin on ${targetCorp.name} (${targetCorp.ip}) and run Revelation from the Remote Console or Tools bar.`,
        difficulty: 6,
        payment: 10000,
        minUplinkRating: 2,
        targetIp: targetCorp.ip,
        accepted: true,
        completed: false,
      });
    }
    if (!existingCodes.has("GRAND_TOUR")) {
      state.missions.unshift({
        id: nextId("mission"),
        kind: "story_special",
        specialMissionCode: "GRAND_TOUR",
        title: "[ARC] The Grand Tour",
        employer: "Andromeda Research Corp",
        description: `Unleash Revelation across ${REVELATION_WIN_THRESHOLD} corporate hosts to trigger uncontrolled internet collapse before Arunmor completes Faith.`,
        difficulty: 9,
        payment: 50000,
        minUplinkRating: 2,
        targetIp: state.story.arcServerIp,
        accepted: true,
        completed: false,
      });
    }
  } else {
    if (!existingCodes.has("BACKFIRE")) {
      state.missions.unshift({
        id: nextId("mission"),
        kind: "story_special",
        specialMissionCode: "BACKFIRE",
        title: "[Arunmor] Backfire",
        employer: "Arunmor Corporation",
        description: `Infiltrate ARC Central Mainframe (${state.story.arcServerIp}), copy Revelation_v1.0.dat, and decrypt it so Arunmor can accelerate Faith.`,
        difficulty: 6,
        payment: 15000,
        minUplinkRating: 2,
        targetIp: state.story.arcServerIp,
        targetFileName: "Revelation_v1.0.dat",
        accepted: true,
        completed: false,
      });
    }
    if (!existingCodes.has("COUNTERATTACK")) {
      state.missions.unshift({
        id: nextId("mission"),
        kind: "story_special",
        specialMissionCode: "COUNTERATTACK",
        title: "[Arunmor] Counterattack",
        employer: "Arunmor Corporation",
        description: `Deploy Faith v${state.story.faithVersion.toFixed(1)} across ${FAITH_WIN_THRESHOLD} corporate servers via Remote Console or Tools to halt ARC's Revelation outbreak.`,
        difficulty: 9,
        payment: 50000,
        minUplinkRating: 2,
        targetIp: state.story.arunmorServerIp,
        accepted: true,
        completed: false,
      });
    }
  }
}
