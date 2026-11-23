import type {
  CpuSpec,
  GatewaySecuritySpec,
  GatewaySpec,
  MemorySpec,
  MissionKind,
  ModemSpec,
  ServerKind,
  SoftwareDefinition,
} from "./types";

/** Starting calendar timestamp: March 24, 2010 00:00:00 UTC (GAME_START_DATE in data.h) */
export const GAME_START_TIME_MS = Date.UTC(2010, 2, 24, 0, 0, 0);

/** Canonical fixed IP addresses from original data.h */
export const FIXED_IPS = {
  LOCALHOST: "127.0.0.1",
  INTERNIC: "458.615.48.651",
  ACADEMIC_DB: "443.65.765.2",
  CRIMINAL_DB: "785.234.87.124",
  SOCIAL_SECURITY_DB: "653.76.235.432",
  MEDICAL_DB: "432.543.12.544",
  STOCK_MARKET: "456.789.159.459",
  PROTOVISION: "284.345.42.283",
  UPLINK_PUBLIC: "234.773.0.666",
  UPLINK_INTERNAL: "128.185.0.8",
  UPLINK_TEST: "128.185.0.4",
} as const;

export const PLAYER_DEFAULTS = {
  credits: 3000,
  creditRating: 10,
  uplinkScore: 1,
  neuromancerScore: 0,
  startCpuGhz: 60,
  startMemoryGq: 24,
  startBandwidthGbps: 1,
  monthlyFee: 300,
  newGatewayCost: 1000,
  gatewayPartExchangeRate: 0.75,
} as const;

/** Exact task tick constants from original data.h */
export const TASK_TICKS = {
  copyPerGq: 45,
  deletePerGq: 9,
  decryptPerGq: 90,
  defragPerGq: 3,
  logDelete: 60,
  logUndelete: 60,
  logModify: 50,
  disableProxy: 150, // analyse 50 + disable 100
  disableFirewall: 120, // analyse 40 + disable 80
  decypherBase: 140,
  voiceAnalyse: 90,
  ipLookup: 40,
  ipProbe: 75,
  lanScan: 300,
  lanProbe: 100,
  lanSpoof: 100,
  lanForce: 100,
  dictionaryBase: 80,
} as const;

export const LOAN_TIERS = [
  { maxAmount: 3000, interestRate: 0.2 },
  { maxAmount: 7000, interestRate: 0.4 },
  { maxAmount: 10000, interestRate: 0.7 },
  { maxAmount: 25000, interestRate: 1.0 },
] as const;

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
  "joshua",
  "andromeda",
  "revelation",
  "faith",
  "arunmor",
  "uplink",
];

/** Base seconds to trace a single hop by server archetype (-1 = no trace) — exact data.h */
export const TRACE_SPEED_SEC: Readonly<Record<ServerKind, number>> = {
  public_access: -1,
  uplink_public: -1,
  uplink_test: 30,
  protovision: 30,
  database_academic: 35,
  database_medical: 25,
  stock_market: 20,
  database_social: 15,
  internic: 15,
  internal_services: 15,
  database_criminal: 10,
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

/** Base hack difficulty (ticks per character) by server archetype — exact data.h */
export const HACK_DIFFICULTY: Readonly<Record<ServerKind, number>> = {
  public_access: 6,
  uplink_public: 30,
  uplink_test: 30,
  internal_services: 45,
  internic: 70,
  central_mainframe: 80,
  database_academic: 90,
  bank: 100,
  database_social: 120,
  database_medical: 120,
  stock_market: 120,
  database_criminal: 180,
  uplink_internal: 300,
  lan: 200,
  protovision: -1, // Unhackable Easter egg
};

export const SECURITY_LEVEL_MODIFIER: readonly number[] = [
  1.0, 2.0, 1.5, 1.2, 1.0, 1.0, 0.9, 0.7, 0.5, 0.5, 0.5,
];

/** Exact NEUROMANCERCHANGE deltas per mission kind (multiplied by difficulty) */
export const NEUROMANCER_MISSION_DELTA: Readonly<Record<MissionKind, number>> = {
  steal_file: 0,
  destroy_file: 5,
  find_data: 0,
  change_academic: -5,
  change_criminal: -5,
  change_social: -5,
  change_medical: -5,
  frame_user: -20,
  trace_user: -30,
  bank_heist: -10,
  remove_computer: 30,
  remove_user: -60,
  lan_infiltration: 0,
  pay_fine: 0,
  story_special: 0,
};

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

/** 8 canonical gateway hubs from PHYSICALGATEWAYLOCATIONS[] scaled to 1000x500 */
export const GATEWAY_LOCATIONS: readonly {
  readonly city: string;
  readonly country: string;
  readonly x: number;
  readonly y: number;
}[] = [
  { city: "London", country: "United Kingdom", x: 475, y: 120 },
  { city: "Tokyo", country: "Japan", x: 865, y: 185 },
  { city: "Los Angeles", country: "USA", x: 155, y: 215 },
  { city: "New York", country: "USA", x: 285, y: 175 },
  { city: "Chicago", country: "USA", x: 235, y: 165 },
  { city: "Moscow", country: "Russia", x: 565, y: 120 },
  { city: "Hong Kong", country: "China", x: 805, y: 235 },
  { city: "Sydney", country: "Australia", x: 910, y: 410 },
];

/** Complete original Uplink SOFTWARE_UPGRADES catalog with exact costs, versions, and sizes */
export const SOFTWARE_CATALOG: readonly SoftwareDefinition[] = [
  // Crackers
  { id: "password_breaker", name: "Password Breaker", version: 1, category: "cracker", cost: 1500, sizeGq: 2, description: "Brute-forces remote password screens character by character." },
  { id: "dictionary_hacker", name: "Dictionary Hacker", version: 1, category: "cracker", cost: 1000, sizeGq: 4, description: "Rapidly tests common dictionary words against password prompts." },
  { id: "decypher", name: "Decypher", version: 1, category: "cracker", cost: 3000, sizeGq: 2, description: "Breaks Elliptic-Curve Encryption Cyphers (Level 1)." },
  { id: "decypher", name: "Decypher", version: 2, category: "cracker", cost: 5000, sizeGq: 2, description: "Faster quadratic algorithm for Elliptic-Curve Cyphers (Level 2)." },
  { id: "decypher", name: "Decypher", version: 3, category: "cracker", cost: 8000, sizeGq: 2, description: "Fastest implementation for all Elliptic-Curve Cyphers (Level 3)." },
  { id: "decrypter", name: "Decrypter", version: 1, category: "cracker", cost: 800, sizeGq: 2, description: "Decrypts Level 1 encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 2, category: "cracker", cost: 1200, sizeGq: 2, description: "Decrypts Level 2 or below encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 3, category: "cracker", cost: 1600, sizeGq: 2, description: "Decrypts Level 3 or below encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 4, category: "cracker", cost: 2200, sizeGq: 2, description: "Decrypts Level 4 or below encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 5, category: "cracker", cost: 3000, sizeGq: 3, description: "Decrypts Level 5 or below encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 6, category: "cracker", cost: 7000, sizeGq: 4, description: "Decrypts Level 6 or below encrypted files." },
  { id: "decrypter", name: "Decrypter", version: 7, category: "cracker", cost: 15000, sizeGq: 5, description: "Decrypts Level 7 or below encrypted files." },

  // File Utilities
  { id: "file_copier", name: "File Copier", version: 1, category: "file_util", cost: 100, sizeGq: 1, description: "Copies programs and data from a remote databank to your gateway." },
  { id: "file_deleter", name: "File Deleter", version: 1, category: "file_util", cost: 100, sizeGq: 1, description: "Deletes programs and data from a databank." },
  { id: "defrag", name: "Defrag", version: 1, category: "file_util", cost: 5000, sizeGq: 2, description: "Compacts gateway memory banks to reclaim contiguous storage blocks." },

  // Security & Log Tools
  { id: "trace_tracker", name: "Trace Tracker", version: 1, category: "security", cost: 300, sizeGq: 1, description: "Alerts when a remote trace begins." },
  { id: "trace_tracker", name: "Trace Tracker", version: 2, category: "security", cost: 600, sizeGq: 1, description: "Displays live trace completion percentage." },
  { id: "trace_tracker", name: "Trace Tracker", version: 3, category: "security", cost: 1400, sizeGq: 2, description: "Displays remaining bounce hops and trace percentage." },
  { id: "trace_tracker", name: "Trace Tracker", version: 4, category: "security", cost: 2500, sizeGq: 3, description: "Displays exact seconds remaining before trace lock." },
  { id: "log_deleter", name: "Log Deleter", version: 1, category: "security", cost: 500, sizeGq: 1, description: "Blanks a log entry, leaving an obvious empty slot." },
  { id: "log_deleter", name: "Log Deleter", version: 2, category: "security", cost: 1000, sizeGq: 1, description: "Deletes a log entry, leaving a distinctive blank gap." },
  { id: "log_deleter", name: "Log Deleter", version: 3, category: "security", cost: 2000, sizeGq: 1, description: "Overwrites your log with a legitimate decoy entry (still recoverable)." },
  { id: "log_deleter", name: "Log Deleter", version: 4, category: "security", cost: 4000, sizeGq: 1, description: "Wipes a log entry and compacts the log bank. Impossible to trace." },
  { id: "log_undeleter", name: "Log UnDeleter", version: 1, category: "security", cost: 5000, sizeGq: 1, description: "Recovers logs erased by Log Deleter v1–v3." },
  { id: "log_modifier", name: "Log Modifier", version: 1, category: "security", cost: 4000, sizeGq: 2, description: "Rewrites the source IP of an existing log entry." },
  { id: "log_modifier", name: "Log Modifier", version: 2, category: "security", cost: 6000, sizeGq: 2, description: "Rewrites existing logs or fabricates new entries in blank slots." },

  // Disablers
  { id: "proxy_disable", name: "Proxy Disable", version: 1, category: "security", cost: 3000, sizeGq: 1, description: "Disables a Level 1 Proxy server (detected immediately)." },
  { id: "proxy_disable", name: "Proxy Disable", version: 2, category: "security", cost: 4000, sizeGq: 1, description: "Disables a Proxy server up to Level 2 (detected immediately)." },
  { id: "proxy_disable", name: "Proxy Disable", version: 3, category: "security", cost: 6000, sizeGq: 1, description: "Disables a Proxy server up to Level 3 (detected immediately)." },
  { id: "proxy_disable", name: "Proxy Disable", version: 4, category: "security", cost: 8000, sizeGq: 2, description: "Disables a Proxy server up to Level 4 (detected immediately)." },
  { id: "proxy_disable", name: "Proxy Disable", version: 5, category: "security", cost: 10000, sizeGq: 3, description: "Disables a Proxy server up to Level 5 (detected immediately)." },
  { id: "firewall_disable", name: "Firewall Disable", version: 1, category: "security", cost: 2000, sizeGq: 1, description: "Disables a Level 1 Firewall (detected immediately)." },
  { id: "firewall_disable", name: "Firewall Disable", version: 2, category: "security", cost: 3000, sizeGq: 1, description: "Disables a Firewall up to Level 2 (detected immediately)." },
  { id: "firewall_disable", name: "Firewall Disable", version: 3, category: "security", cost: 4000, sizeGq: 1, description: "Disables a Firewall up to Level 3 (detected immediately)." },
  { id: "firewall_disable", name: "Firewall Disable", version: 4, category: "security", cost: 6000, sizeGq: 2, description: "Disables a Firewall up to Level 4 (detected immediately)." },
  { id: "firewall_disable", name: "Firewall Disable", version: 5, category: "security", cost: 8000, sizeGq: 3, description: "Disables a Firewall up to Level 5 (detected immediately)." },

  // Bypassers (require HUD: Connection Analysis)
  { id: "proxy_bypass", name: "Proxy Bypass", version: 1, category: "bypasser", cost: 6000, sizeGq: 1, description: "Silently bypasses Level 1 Proxy (requires HUD: Connection Analysis)." },
  { id: "proxy_bypass", name: "Proxy Bypass", version: 2, category: "bypasser", cost: 8000, sizeGq: 1, description: "Silently bypasses Proxy up to Level 2." },
  { id: "proxy_bypass", name: "Proxy Bypass", version: 3, category: "bypasser", cost: 12000, sizeGq: 1, description: "Silently bypasses Proxy up to Level 3." },
  { id: "proxy_bypass", name: "Proxy Bypass", version: 4, category: "bypasser", cost: 16000, sizeGq: 1, description: "Silently bypasses Proxy up to Level 4." },
  { id: "proxy_bypass", name: "Proxy Bypass", version: 5, category: "bypasser", cost: 20000, sizeGq: 1, description: "Silently bypasses Proxy up to Level 5." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 1, category: "bypasser", cost: 3000, sizeGq: 1, description: "Silently bypasses Level 1 Firewall." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 2, category: "bypasser", cost: 4000, sizeGq: 1, description: "Silently bypasses Firewall up to Level 2." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 3, category: "bypasser", cost: 6000, sizeGq: 1, description: "Silently bypasses Firewall up to Level 3." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 4, category: "bypasser", cost: 8000, sizeGq: 1, description: "Silently bypasses Firewall up to Level 4." },
  { id: "firewall_bypass", name: "Firewall Bypass", version: 5, category: "bypasser", cost: 10000, sizeGq: 1, description: "Silently bypasses Firewall up to Level 5." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 1, category: "bypasser", cost: 10000, sizeGq: 1, description: "Silently bypasses Level 1 Monitor." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 2, category: "bypasser", cost: 12000, sizeGq: 1, description: "Silently bypasses Monitor up to Level 2." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 3, category: "bypasser", cost: 16000, sizeGq: 1, description: "Silently bypasses Monitor up to Level 3." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 4, category: "bypasser", cost: 20000, sizeGq: 1, description: "Silently bypasses Monitor up to Level 4." },
  { id: "monitor_bypass", name: "Monitor Bypass", version: 5, category: "bypasser", cost: 25000, sizeGq: 1, description: "Silently bypasses Monitor up to Level 5." },

  // HUD Upgrades
  { id: "hud_map_show_trace", name: "HUD: Map Show Trace", version: 1, category: "hud", cost: 5000, sizeGq: 1, description: "Displays live active trace hops directly on the Global Bounce Map." },
  { id: "hud_connection_analysis", name: "HUD: Connection Analysis", version: 1, category: "hud", cost: 20000, sizeGq: 3, description: "Reveals target security systems and enables active Bypass software." },
  { id: "hud_lan_view", name: "HUD: LAN View", version: 1, category: "hud", cost: 50000, sizeGq: 5, description: "Enables Corporate LAN topology mapping and LAN intrusion tools." },
  { id: "hud_irc_client", name: "HUD: IRC Client", version: 1, category: "hud", cost: 4000, sizeGq: 2, description: "Adds an underground agent IRC terminal to your HUD." },

  // Other Utilities
  { id: "ip_lookup", name: "IP Lookup", version: 1, category: "other", cost: 500, sizeGq: 1, description: "Resolves any raw IP address and adds it to your discovered links." },
  { id: "ip_probe", name: "IP Probe", version: 1, category: "other", cost: 2000, sizeGq: 3, description: "Scans a target IP and reports installed security system types." },
  { id: "ip_probe", name: "IP Probe", version: 2, category: "other", cost: 4000, sizeGq: 3, description: "Scans a target IP and reports security types and versions." },
  { id: "ip_probe", name: "IP Probe", version: 3, category: "other", cost: 5000, sizeGq: 3, description: "Scans a target IP and reports security types, versions, and live status." },
  { id: "voice_analyser", name: "Voice Analyser", version: 1, category: "other", cost: 5000, sizeGq: 4, description: "Records and synthesizes executive voiceprints for Voice Auth screens." },

  // LAN Tools
  { id: "lan_scan", name: "LAN Scan", version: 1, category: "lan", cost: 10000, sizeGq: 2, description: "Scans a corporate LAN for Level 1 systems." },
  { id: "lan_scan", name: "LAN Scan", version: 2, category: "lan", cost: 15000, sizeGq: 2, description: "Scans a corporate LAN for systems up to Level 2." },
  { id: "lan_scan", name: "LAN Scan", version: 3, category: "lan", cost: 25000, sizeGq: 2, description: "Scans an entire corporate LAN for all systems up to Level 3." },
  { id: "lan_probe", name: "LAN Probe", version: 1, category: "lan", cost: 15000, sizeGq: 3, description: "Probes links on a Level 1 LAN node." },
  { id: "lan_probe", name: "LAN Probe", version: 2, category: "lan", cost: 20000, sizeGq: 3, description: "Probes links on a LAN node up to Level 2." },
  { id: "lan_probe", name: "LAN Probe", version: 3, category: "lan", cost: 30000, sizeGq: 4, description: "Probes all links and hidden ports on any LAN node." },
  { id: "lan_spoof", name: "LAN Spoof", version: 1, category: "lan", cost: 20000, sizeGq: 2, description: "Spoofs a Level 1 LAN system's identity." },
  { id: "lan_spoof", name: "LAN Spoof", version: 2, category: "lan", cost: 30000, sizeGq: 3, description: "Spoofs LAN systems up to Level 2." },
  { id: "lan_spoof", name: "LAN Spoof", version: 3, category: "lan", cost: 45000, sizeGq: 5, description: "Spoofs any LAN system up to Level 3." },
  { id: "lan_force", name: "LAN Force", version: 1, category: "lan", cost: 15000, sizeGq: 2, description: "Forces open a Level 1 LAN lock (alerts Sysadmin)." },
  { id: "lan_force", name: "LAN Force", version: 2, category: "lan", cost: 20000, sizeGq: 3, description: "Forces open LAN locks up to Level 2 (alerts Sysadmin)." },
  { id: "lan_force", name: "LAN Force", version: 3, category: "lan", cost: 25000, sizeGq: 4, description: "Forces open any LAN lock up to Level 3 (alerts Sysadmin)." },
];

/** Exact 7 CPUs from original HARDWARE_UPGRADES[] */
export const CPU_CATALOG: readonly CpuSpec[] = [
  { id: "cpu_20", name: "CPU (20 GHz)", ghz: 20, cost: 250 },
  { id: "cpu_60", name: "CPU (60 GHz)", ghz: 60, cost: 1000 },
  { id: "cpu_80", name: "CPU (80 GHz)", ghz: 80, cost: 1300 },
  { id: "cpu_100", name: "CPU (100 GHz)", ghz: 100, cost: 3000 },
  { id: "cpu_120", name: "CPU (120 GHz)", ghz: 120, cost: 5000 },
  { id: "cpu_150", name: "CPU (150 GHz)", ghz: 150, cost: 8000 },
  { id: "cpu_200", name: "CPU (Turbo 200 GHz)", ghz: 200, cost: 12000 },
];

/** Exact 6 Modems from original HARDWARE_UPGRADES[] */
export const MODEM_CATALOG: readonly ModemSpec[] = [
  { id: "modem_1", name: "Modem (1 Gq/s)", gbps: 1, cost: 1000 },
  { id: "modem_2", name: "Modem (2 Gq/s)", gbps: 2, cost: 2000 },
  { id: "modem_4", name: "Modem (4 Gq/s)", gbps: 4, cost: 4000 },
  { id: "modem_6", name: "Modem (6 Gq/s)", gbps: 6, cost: 6000 },
  { id: "modem_8", name: "Modem (8 Gq/s)", gbps: 8, cost: 8000 },
  { id: "modem_10", name: "Modem (10 Gq/s)", gbps: 10, cost: 10000 },
];

/** Exact 4 Memory Banks from original HARDWARE_UPGRADES[] */
export const MEMORY_CATALOG: readonly MemorySpec[] = [
  { id: "mem_8", name: "Memory (8 Gq)", gq: 8, cost: 3000 },
  { id: "mem_16", name: "Memory (16 Gq)", gq: 16, cost: 5500 },
  { id: "mem_24", name: "Memory (24 Gq)", gq: 24, cost: 8000 },
  { id: "mem_32", name: "Memory (32 Gq)", gq: 32, cost: 11000 },
];

/** Exact 2 Gateway Security Devices from original HARDWARE_UPGRADES[] */
export const GATEWAY_SECURITY_CATALOG: readonly GatewaySecuritySpec[] = [
  {
    id: "motion_sensor",
    name: "Gateway Motion Sensor",
    cost: 10000,
    slots: 1,
    description: "Ultrasonic sensor that alerts you when federal agents approach your physical gateway.",
  },
  {
    id: "self_destruct",
    name: "Gateway Self Destruct",
    cost: 20000,
    slots: 1,
    description: "Explosive charge that vaporizes your gateway and all forensic evidence before seizure.",
  },
];

/** Canonical Uplink Gateway progression including Virtuanet (anonymous) & Trinity */
export const GATEWAY_CATALOG: readonly GatewaySpec[] = [
  {
    id: "alpha",
    name: "Alpha Gateway",
    cost: 0,
    maxCpus: 1,
    maxMemoryGq: 24,
    maxSecuritySlots: 1,
    bandwidthGbps: 1,
    description: "Entry-level single-CPU gateway issued to new Uplink agents.",
  },
  {
    id: "beta",
    name: "Beta-2 Dual",
    cost: 8000,
    maxCpus: 2,
    maxMemoryGq: 48,
    maxSecuritySlots: 2,
    bandwidthGbps: 2,
    description: "Dual-CPU chassis with expanded memory banks and dual security bays.",
  },
  {
    id: "gamma",
    name: "Gamma-4 Tower",
    cost: 18000,
    maxCpus: 4,
    maxMemoryGq: 96,
    maxSecuritySlots: 2,
    bandwidthGbps: 4,
    description: "Quad-slot rackmount rig suited for high-speed bank and mainframe intrusions.",
  },
  {
    id: "virtuanet",
    name: "VirtuaNet Anonymous",
    cost: 45000,
    maxCpus: 2,
    maxMemoryGq: 64,
    maxSecuritySlots: 2,
    bandwidthGbps: 6,
    anonymous: true,
    description: "Untraceable dark-routed gateway. Federal traces disconnect cleanly without arrest.",
  },
  {
    id: "trinity",
    name: "Trinity-X Quad",
    cost: 75000,
    maxCpus: 8,
    maxMemoryGq: 256,
    maxSecuritySlots: 4,
    bandwidthGbps: 10,
    description: "Flagship 8-CPU super-gateway engineered for LAN raids and Revelation warfare.",
  },
];

export function getUplinkRatingName(score: number): string {
  let current = UPLINK_RATINGS[0]!.name;
  for (const r of UPLINK_RATINGS) {
    if (score >= r.minScore) current = r.name;
  }
  return current;
}

export function getUplinkRatingIndex(score: number): number {
  let idx = 0;
  for (let i = 0; i < UPLINK_RATINGS.length; i++) {
    if (score >= UPLINK_RATINGS[i]!.minScore) idx = i;
  }
  return idx;
}

export function getNeuromancerRatingName(score: number): string {
  let current = NEUROMANCER_RATINGS[0]!.name;
  for (const r of NEUROMANCER_RATINGS) {
    if (score >= r.minScore) current = r.name;
  }
  return current;
}
