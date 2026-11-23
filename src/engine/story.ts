import type { WorldState } from "./types";

export const REVELATION_WIN_THRESHOLD = 5;
export const FAITH_WIN_THRESHOLD = 5;

/**
 * Evaluates ARC vs. Arunmor storyline progression based on player rating and
 * deployed Revelation/Faith payloads.
 */
export function checkStoryTriggers(
  state: WorldState,
  nextId: (prefix: string) => string
): { stageChanged: boolean; headline?: string } {
  if (state.story.stage === "dormant" && state.player.uplinkScore >= 6) {
    state.story.stage = "dead_agent_email";
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
        `Andromeda Research Corporation (ARC) at ${state.story.arcServerIp} is preparing to unleash a destructive worm called REVELATION. ` +
        `Arunmor Corporation (${state.story.arunmorServerIp}) is building a counter-measure called FAITH.\n\n` +
        `Choose your side in the Storyline tab—install Revelation to burn the net for ARC, or install Faith to purge infected systems for Arunmor.`,
      timestampMs: state.timeMs,
      read: false,
    });

    const headline = "Top Uplink Agent Found Dead; Rumors of 'Revelation' Worm Surface";
    state.news.unshift({
      id: nextId("news"),
      timestampMs: state.timeMs,
      headline,
      body: "Authorities are investigating the sudden disappearance of a veteran freelance agent linked to Andromeda Research Corporation.",
    });
    return { stageChanged: true, headline };
  }

  if (state.story.stage === "active_war") {
    if (state.story.revelationCount >= REVELATION_WIN_THRESHOLD) {
      state.story.stage = "arc_victory";
      const headline = "GLOBAL NET COLLAPSE: ARC's Revelation Reaches Critical Mass";
      state.news.unshift({
        id: nextId("news"),
        timestampMs: state.timeMs,
        headline,
        body: "Critical corporate backbones have succumbed to Revelation. ARC declares total victory.",
      });
      return { stageChanged: true, headline };
    }
    if (state.story.faithCount >= FAITH_WIN_THRESHOLD) {
      state.story.stage = "arunmor_victory";
      const headline = "NET SECURED: Arunmor's Faith Neutralizes Revelation";
      state.news.unshift({
        id: nextId("news"),
        timestampMs: state.timeMs,
        headline,
        body: "Arunmor Corporation confirms that Faith has purged Revelation from global infrastructure.",
      });
      return { stageChanged: true, headline };
    }
  }

  return { stageChanged: false };
}
