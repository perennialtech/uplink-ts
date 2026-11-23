import type { CpuSpec, GatewaySpec, ServerKind, SoftwareDefinition } from "./types";

/** Starting calendar timestamp: March 24, 2010 00:00:00 UTC */
export const GAME_START_TIME_MS = Date.UTC(2010, 2, 24, 0, 0, 0);

export const PLAYER_DEFAULTS = {
  credits: 3000,
  uplinkScore: 1,
  neuromancerScore: 0,
  startCpuGhz: 60,
  startMemoryGq: 24,
  startBandwidthGbps: 1,
} as const;

export const TASK_TICKS = {
  copyPerGq: 45,
  deletePerGq: 9,
  decryptPerGq: 90,
  logDelete: 60,
  logUndelete: 60,
  logModify: 50,
  disableProxy: 150,
  disableFirewall: 120,
  lanScan: 180,
  lanProbe: 90,
  lanSpoof: 100,
  lanForce: 100,
  dictionaryBase: 80,
} as const;

export const DICTIONARY_WORDS: readonly string[] = [
  "admin",
  "rosebud",
  "password",
  "phoenix",
  "obsidian",
  "protocol",
  "cipher",
  "vector",
  "mercury",
  "eclipse",
  "valkyrie",
  "sentinel",
  "cascade",
  "horizon",
  "solstice",
  "vault",
  "override",
  "nexus",
];

/** Base seconds to trace a single hop by server archetype (-1 = no trace) */
export const TRACE_SPEED_SEC: Readonly<Record<ServerKind, number>> = {
  public_access: -1,
  uplink_test: 30,
  database_academic: 35,
  database_social: 15,
  database_criminal: 10,
  internic: 15,
  internal_services: 15,
  central_mainframe: 5,
  bank: 5,
  uplink_internal: 5,
  lan: 5,
};

/** Multipliers applied to each bounce hop based on player privilege on that node */
export const TRACE_BOUNCE_MODIFIER = {
  noAccount: 0.1,
  hasAccount: 0.7,
  adminAccess: 1.0,
  centralMainframe: 1.3,
  bankAdmin: 1.6,
} as const;

/** Base hack difficulty (ticks per character) by server archetype */
export const HACK_DIFFICULTY: Readonly<Record<ServerKind, number>> = {
  public_access: 6,
  uplink_test: 30,
  internal_services: 45,
  internic: 70,
  central_mainframe: 80,
  database_academic: 90,
  bank: 100,
  database_social: 120,
  database_criminal: 180,
  uplink_internal: 300,
  lan: 200,
};

export const SECURITY_LEVEL_MODIFIER: readonly number[] = [
  1.0, 2.0, 1.5, 1.2, 1.0, 1.0, 0.9, 0.7, 0.5, 0.5, 0.5,
];

export const UPLINK_RATINGS: readonly { readonly name: string; readonly minScore: number }[] = [
  { name: "Unregistered", minScore: 0 },
  { name: "Registered", minScore: 1 },
  { name: "Beginner", minScore: 2 },
  { name: "Novice", minScore: 6 },
  { name: "Confident", minScore: 15 },
  { name: "Intermediate", minScore: 35 },
  { name: "Skilled", minScore: 60 },
  { name: "Experienced", minScore: 90 },
  { name: "Knowledgeable", minScore: 125 },
  { name: "Uber-Skilled", minScore: 160 },
  { name: "Professional", minScore: 220 },
  { name: "Elite", minScore: 300 },
  { name: "Mage", minScore: 400 },
  { name: "Expert", minScore: 600 },
  { name: "Veteran", minScore: 1000 },
  { name: "Techno-mage", minScore: 1500 },
  { name: "TERMINAL", minScore: 2500 },
];

export const NEUROMANCER_RATINGS: readonly { readonly name: string; readonly minScore: number }[] = [
  { name: "Morally Bankrupt", minScore: -1024 },
  { name: "Sociopathic", minScore: -512 },
  { name: "Indiscriminate", minScore: -128 },
  { name: "Notorious", minScore: -32 },
  { name: "Untrustworthy", minScore: -16 },
  { name: "Neutral", minScore: 0 },
  { name: "Aggressive", minScore: 32 },
  { name: "Single Minded", minScore: 64 },
  { name: "Activist", minScore: 256 },
  { name: "Anarchic", minScore: 1024 },
  { name: "Revolutionary", minScore: 2048 },
];

export const GATEWAY_LOCATIONS: readonly {
  readonly city: string;
  readonly country: string;
  readonly x: number;
  readonly y: number;
}[] = [
  { city: "London", country: "United Kingdom", x: 470, y: 125 },
  { city: "New York", country: "USA", x: 285, y: 175 },
  { city: "Los Angeles", country: "USA", x: 155, y: 215 },
  { city: "Chicago", country: "USA", x: 235, y: 165 },
  { city: "Moscow", country: "Russia", x: 565, y: 120 },
  { city: "Tokyo", country: "Japan", x: 860, y: 190 },
  { city: "Hong Kong", country: "China", x: 805, y: 235 },
  { city: "Sydney", country: "Australia", x: 905, y: 415 },
];

export const SOFTWARE_CATALOG: readonly SoftwareDefinition[] = [
  { id: "password_breaker", name: "Password Breaker", version: 1, category: "cracker", cost: 1500, sizeGq: 2, description: "Brute-forces remote passwords character by character." },
  { id: "dictionary_hacker", name: "Dictionary Hacker", version: 1, category: "cracker", cost: 1000, sizeGq: 4, description: "Rapidly tests common dictionary words against password prompts." },
  { id: "trace_tracker", name: "Trace Tracker", version: 1, category: "security", cost: 300, sizeGq: 1, description: "Alerts when a remote trace begins." },
  { id: "trace_tracker", name: "Trace Tracker", version: 2, category: "security", cost: 600, sizeGq: 1, description: "Displays live trace completion percentage." },
  { id: "trace_tracker", name: "Trace Tracker", version: 3, category: "security", cost: 1400, sizeGq: 1, description: "Displays remaining bounce hops and percentage." },
  { id: "trace_tracker", name: "Trace Tracker", version: 4, category: "security", cost: 2500, sizeGq: 1, description: "Displays exact seconds remaining before trace lock." },
  { id: "log_deleter", name: "Log Deleter", version: 1, category: "file_util", cost: 500, sizeGq: 1, description: "Blanks a log entry (easily spotted and recovered)." },
  { id: "log_deleter", name: "Log Deleter", version: 2, category: "file_util", cost: 1000, sizeGq: 1, description: "Overwrites a log entry (recoverable with Log Undeleter)." },
  { id: "log_deleter", name: "Log Deleter", version: 4, category: "file_util", cost: 4000, sizeGq: 1, description: "Cleanly wipes a log entry so passive traces stop cold." },
  { id: "log_undeleter", name: "Log Undeleter", version: 1, category: "file_util", cost: 5000, sizeGq: 1, description: "Recovers logs erased by Log Deleter v1–v3." },
  { id: "log_modifier", name: "Log Modifier", version: 1, category: "file_util", cost: 4000, sizeGq: 1, description: "Rewrites the source IP of a log entry to deflect traces or frame targets." },
  { id: "file_copier", name: "File Copier", version: 1, category: "file_util", cost: 0, sizeGq: 1, description: "Downloads files from a remote server to your gateway." },
  { id: "file_deleter", name: "File Deleter", version: 1, category: "file_util", cost: 0, sizeGq: 1, description: "Deletes files from local or remote storage." },
  { id: "decrypter", name: "Decrypter", version: 1, category: "cracker", cost: 800, sizeGq: 2, description: "Decrypts Level 1 encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 3, category: "cracker", cost: 1600, sizeGq: 2, description: "Decrypts up to Level 3 encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 5, category: "cracker", cost: 3000, sizeGq: 3, description: "Decrypts up to Level 5 encrypted files." },
  { id: "proxy_disable", name: "Proxy Disable", version: 1, category: "cracker", cost: 2500, sizeGq: 2, description: "Disables a remote Proxy server (triggers trace)." },
  { id: "proxy_bypass", name: "Proxy Bypass", version: 5, category: "bypasser", cost: 10000, sizeGq: 1, description: "Silently bypasses Proxy up to Level 5 without triggering trace." },
  { id: "firewall_disable", name: "Firewall Disable", version: 1, category: "cracker", cost: 2500, sizeGq: 2, description: "Disables a remote Firewall (triggers trace)." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 5, category: "bypasser", cost: 10000, sizeGq: 1, description: "Silently bypasses Firewall up to Level 5." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 5, category: "bypasser", cost: 10000, sizeGq: 1, description: "Delays active trace detection on Monitor up to Level 5." },
  { id: "lan_scan", name: "LAN Scan", version: 3, category: "lan", cost: 6000, sizeGq: 2, description: "Discovers routers, hubs, locks, and terminals inside corporate LANs." },
  { id: "lan_probe", name: "LAN Probe", version: 3, category: "lan", cost: 4000, sizeGq: 2, description: "Maps outgoing links from any visible LAN node." },
  { id: "lan_spoof", name: "LAN Spoof", version: 3, category: "lan", cost: 5000, sizeGq: 2, description: "Spoofs an Auth Server or subnet node to unlock protected LAN locks." },
  { id: "lan_force", name: "LAN Force", version: 1, category: "lan", cost: 6000, sizeGq: 2, description: "Forces a LAN lock open immediately (alerts the LAN sysadmin)." },
];

export const CPU_CATALOG: readonly CpuSpec[] = [
  { id: "cpu_60", name: "CPU (60 GHz)", ghz: 60, cost: 1000 },
  { id: "cpu_100", name: "CPU (100 GHz)", ghz: 100, cost: 2500 },
  { id: "cpu_150", name: "CPU (150 GHz)", ghz: 150, cost: 6000 },
  { id: "cpu_200", name: "CPU (200 GHz)", ghz: 200, cost: 12000 },
];

export const GATEWAY_CATALOG: readonly GatewaySpec[] = [
  { id: "alpha", name: "Alpha Gateway", cost: 0, maxCpus: 1, maxMemoryGq: 24, maxSecuritySlots: 1, bandwidthGbps: 1, description: "Entry-level single-CPU gateway issued to new agents." },
  { id: "beta", name: "Beta-2 Dual", cost: 6000, maxCpus: 2, maxMemoryGq: 48, maxSecuritySlots: 2, bandwidthGbps: 2, description: "Dual-CPU chassis with expanded memory banks." },
  { id: "trinity", name: "Trinity-X Quad", cost: 22000, maxCpus: 4, maxMemoryGq: 128, maxSecuritySlots: 4, bandwidthGbps: 8, description: "High-density quad-CPU rig built for bank and LAN raids." },
];

export function getUplinkRatingName(score: number): string {
  let current = UPLINK_RATINGS[0]!.name;
  for (const r of UPLINK_RATINGS) {
    if (score >= r.minScore) current = r.name;
  }
  return current;
}

export function getNeuromancerRatingName(score: number): string {
  let current = NEUROMANCER_RATINGS[0]!.name;
  for (const r of NEUROMANCER_RATINGS) {
    if (score >= r.minScore) current = r.name;
  }
  return current;
}
