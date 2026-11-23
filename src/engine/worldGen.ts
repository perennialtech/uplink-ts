import {
  GAME_START_TIME_MS,
  GATEWAY_LOCATIONS,
  HACK_DIFFICULTY,
  PLAYER_DEFAULTS,
  TRACE_SPEED_SEC,
} from "./catalog";
import { SeededRng } from "./rng";
import type {
  EmailMessage,
  LanNode,
  Mission,
  ServerKind,
  ServerNode,
  VirtualFile,
  WorldState,
} from "./types";

const COMPANIES = [
  "Aegis Biotech",
  "Helios Dynamics",
  "Kestrel Financial",
  "Vanguard Micro",
  "Solstice Energy",
  "Obsidian Systems",
  "Meridian Logistics",
  "Cinder Telecom",
  "Arcturus Defense",
  "Novus Pharma",
  "Stratos Aerospace",
  "Pinnacle Media",
] as const;

const PASSWORDS = [
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
] as const;

const FILE_PREFIXES = [
  "project",
  "ledger",
  "research",
  "blueprint",
  "telemetry",
  "archive",
  "manifest",
  "kernel",
] as const;

function makeIp(rng: SeededRng, used: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const ip = `${rng.int(11, 220)}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(2, 250)}`;
    if (!used.has(ip)) {
      used.add(ip);
      return ip;
    }
  }
  throw new Error("Failed to allocate unique IP");
}

function makeFiles(rng: SeededRng, companySlug: string, count: number, encryptedChance: number): VirtualFile[] {
  const files: VirtualFile[] = [];
  for (let i = 0; i < count; i++) {
    const prefix = rng.pick(FILE_PREFIXES);
    const num = rng.int(10, 99);
    const encryptedLevel = rng.chance(encryptedChance) ? rng.int(1, 3) : 0;
    files.push({
      id: `file_${companySlug}_${i}_${num}`,
      name: `${companySlug}_${prefix}_${num}.dat`,
      sizeGq: rng.int(2, 8),
      encryptedLevel,
    });
  }
  return files;
}

function makeSampleLan(): LanNode[] {
  return [
    { id: "router", kind: "router", x: 90, y: 150, visible: true, unlocked: true, connectedTo: ["hub_1"] },
    { id: "hub_1", kind: "hub", x: 230, y: 150, visible: false, unlocked: true, connectedTo: ["router", "term_1", "lock_1"] },
    { id: "term_1", kind: "terminal", x: 230, y: 60, visible: false, unlocked: true, connectedTo: ["hub_1"] },
    { id: "lock_1", kind: "lock", x: 380, y: 150, visible: false, unlocked: false, connectedTo: ["hub_1", "auth_1", "main"] },
    { id: "auth_1", kind: "auth_server", x: 380, y: 245, visible: false, unlocked: true, connectedTo: ["lock_1"] },
    { id: "main", kind: "main_server", x: 540, y: 150, visible: false, unlocked: false, connectedTo: ["lock_1"] },
  ];
}

export function createInitialWorld(handle: string, seed = 20100324): WorldState {
  const rng = new SeededRng(seed);
  const usedIps = new Set<string>(["127.0.0.1"]);
  const servers: Record<string, ServerNode> = {};

  const homeLoc = GATEWAY_LOCATIONS[0]!; // London
  const playerIp = "127.0.0.1";

  const addServer = (params: {
    name: string;
    companyName: string;
    kind: ServerKind;
    x: number;
    y: number;
    discovered: boolean;
    playerAccess?: "none" | "user" | "admin";
    adminPassword?: string;
    security?: ServerNode["security"];
    files?: VirtualFile[];
    lanNodes?: LanNode[];
  }): ServerNode => {
    const ip = makeIp(rng, usedIps);
    const node: ServerNode = {
      ip,
      name: params.name,
      companyName: params.companyName,
      kind: params.kind,
      x: params.x,
      y: params.y,
      traceSpeedSec: TRACE_SPEED_SEC[params.kind],
      hackDifficulty: HACK_DIFFICULTY[params.kind],
      discovered: params.discovered,
      playerAccess: params.playerAccess ?? "none",
      security: params.security ?? [],
      accounts: [
        {
          username: "admin",
          password: params.adminPassword ?? rng.pick(PASSWORDS),
          securityLevel: 1,
        },
      ],
      files: params.files ?? [],
      logs: [],
      bankAccounts: [],
      ...(params.lanNodes ? { lanNodes: params.lanNodes } : {}),
    };
    servers[ip] = node;
    return node;
  };

  // Core world infrastructure
  const internic = addServer({
    name: "InterNIC",
    companyName: "InterNIC",
    kind: "internic",
    x: 285,
    y: 175,
    discovered: true,
    playerAccess: "admin",
    adminPassword: "admin",
    security: [],
  });

  const uplinkInternal = addServer({
    name: "Uplink Internal Services",
    companyName: "Uplink Corporation",
    kind: "uplink_internal",
    x: 470,
    y: 125,
    discovered: true,
    playerAccess: "user",
    security: [
      { kind: "monitor", level: 5, enabled: true, bypassed: false },
      { kind: "proxy", level: 5, enabled: true, bypassed: false },
      { kind: "firewall", level: 5, enabled: true, bypassed: false },
    ],
  });

  const testMachine = addServer({
    name: "Uplink Test Machine",
    companyName: "Uplink Corporation",
    kind: "uplink_test",
    x: 430,
    y: 155,
    discovered: true,
    adminPassword: "rosebud",
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
    files: [
      { id: "file_test_1", name: "Uplink_Test_Data.dat", sizeGq: 3, encryptedLevel: 0 },
    ],
  });

  addServer({
    name: "Global Criminal Database",
    companyName: "Interpol",
    kind: "database_criminal",
    x: 505,
    y: 150,
    discovered: false,
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 2, enabled: true, bypassed: false },
    ],
  });

  addServer({
    name: "International Academic Database",
    companyName: "World Education Council",
    kind: "database_academic",
    x: 245,
    y: 195,
    discovered: false,
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
  });

  const bank = addServer({
    name: "First International Bank",
    companyName: "First International Bank",
    kind: "bank",
    x: 515,
    y: 135,
    discovered: true,
    security: [
      { kind: "monitor", level: 4, enabled: true, bypassed: false },
      { kind: "proxy", level: 4, enabled: true, bypassed: false },
      { kind: "firewall", level: 4, enabled: true, bypassed: false },
    ],
  });
  bank.bankAccounts.push({
    accountNumber: "1004921",
    ownerName: handle,
    password: "vault",
    balance: PLAYER_DEFAULTS.credits,
    loan: 0,
  });

  // Procedural corporate servers across the globe
  const corpNodes: ServerNode[] = [];
  for (let i = 0; i < COMPANIES.length; i++) {
    const company = COMPANIES[i]!;
    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const kind: ServerKind =
      i % 4 === 0
        ? "public_access"
        : i % 4 === 3
          ? "central_mainframe"
          : "internal_services";

    const x = rng.int(110, 910);
    const y = rng.int(95, 420);
    const security: ServerNode["security"] = [];
    if (kind !== "public_access") {
      security.push({ kind: "monitor", level: kind === "central_mainframe" ? 3 : 1, enabled: true, bypassed: false });
    }
    if (kind === "central_mainframe") {
      security.push({ kind: "proxy", level: 2, enabled: true, bypassed: false });
      security.push({ kind: "firewall", level: 2, enabled: true, bypassed: false });
    }

    const node = addServer({
      name:
        kind === "public_access"
          ? `${company} Public Access`
          : kind === "central_mainframe"
            ? `${company} Central Mainframe`
            : `${company} Internal Services`,
      companyName: company,
      kind,
      x,
      y,
      discovered: i < 5,
      security,
      files: makeFiles(rng, slug, rng.int(2, 4), kind === "central_mainframe" ? 0.5 : 0.15),
    });
    corpNodes.push(node);
  }

  // One corporate LAN target
  addServer({
    name: "Arcturus Local Area Network",
    companyName: "Arcturus Defense",
    kind: "lan",
    x: 845,
    y: 210,
    discovered: true,
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 3, enabled: true, bypassed: false },
    ],
    files: [{ id: "file_lan_secret", name: "arcturus_prototype.dat", sizeGq: 5, encryptedLevel: 2 }],
    lanNodes: makeSampleLan(),
  });

  // Initial Missions
  const missions: Mission[] = [
    {
      id: "mission_tutorial",
      kind: "steal_file",
      title: "Uplink Test Contract",
      employer: "Uplink Corporation",
      description: `Connect to ${testMachine.name} (${testMachine.ip}), crack the admin login, copy Uplink_Test_Data.dat to your gateway, and scrub your logs at InterNIC.`,
      difficulty: 1,
      payment: 1500,
      minUplinkRating: 0,
      targetIp: testMachine.ip,
      targetFileName: "Uplink_Test_Data.dat",
      accepted: false,
      completed: false,
    },
  ];

  const internalTargets = corpNodes.filter((n) => n.kind === "internal_services" && n.files.length > 0);
  internalTargets.slice(0, 4).forEach((target, idx) => {
    const file = target.files[0]!;
    const isDestroy = idx % 2 === 1;
    missions.push({
      id: `mission_corp_${idx + 1}`,
      kind: isDestroy ? "destroy_file" : "steal_file",
      title: isDestroy
        ? `Destroy corporate data at ${target.companyName}`
        : `Acquire confidential file from ${target.companyName}`,
      employer: COMPANIES[(idx + 5) % COMPANIES.length]!,
      description: isDestroy
        ? `Break into ${target.name} (${target.ip}) and delete ${file.name}. Cover your tracks afterward.`
        : `Break into ${target.name} (${target.ip}) and copy ${file.name} to your gateway memory.`,
      difficulty: 2 + idx,
      payment: (isDestroy ? 1400 : 1800) + idx * 600,
      minUplinkRating: idx < 2 ? 0 : 2,
      targetIp: target.ip,
      targetFileName: file.name,
      accepted: false,
      completed: false,
    });
  });

  const emails: EmailMessage[] = [
    {
      id: "email_welcome",
      from: "internal@uplink.net",
      subject: "Welcome to Uplink",
      body:
        `Agent ${handle},\n\n` +
        `Your Alpha Gateway in ${homeLoc.city} is online with 60 GHz CPU, 24 Gq memory, and 3,000 credits.\n\n` +
        `Tip: Always bounce your connection through InterNIC (${internic.ip}) first, then through several other nodes before hitting your target. ` +
        `After disconnecting, reconnect to InterNIC and erase your bounce log with Log Deleter v4 to defeat passive traces.\n\n` +
        `Check the Mission Board on ${uplinkInternal.name} to accept your first contract.`,
      timestampMs: GAME_START_TIME_MS,
      read: false,
    },
  ];

  return {
    schemaVersion: 1,
    seed,
    rngState: rng.getState(),
    timeMs: GAME_START_TIME_MS,
    timeScale: 1,
    player: {
      handle,
      credits: PLAYER_DEFAULTS.credits,
      uplinkScore: PLAYER_DEFAULTS.uplinkScore,
      neuromancerScore: PLAYER_DEFAULTS.neuromancerScore,
      disavowed: false,
      gateway: {
        specId: "alpha",
        locationCity: homeLoc.city,
        ip: playerIp,
        x: homeLoc.x,
        y: homeLoc.y,
        cpusGhz: [PLAYER_DEFAULTS.startCpuGhz],
        memoryTotalGq: PLAYER_DEFAULTS.startMemoryGq,
        bandwidthGbps: PLAYER_DEFAULTS.startBandwidthGbps,
        files: [],
        software: [
          { id: "password_breaker", version: 1, sizeGq: 2 },
          { id: "trace_tracker", version: 2, sizeGq: 1 },
          { id: "file_copier", version: 1, sizeGq: 1 },
          { id: "file_deleter", version: 1, sizeGq: 1 },
          { id: "log_deleter", version: 1, sizeGq: 1 },
        ],
      },
      savedBounceRoute: [internic.ip],
    },
    servers,
    connection: {
      route: [playerIp],
      connected: false,
      authenticatedAs: "none",
      traceActive: false,
      traceHopsCompleted: 0,
      secondsUntilNextHop: 0,
      totalTraceSecondsRemaining: 0,
      totalTraceSecondsInitial: 0,
    },
    tasks: [],
    missions,
    emails,
    scheduledEvents: [],
    idCounter: 100,
  };
}
