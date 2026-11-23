import {
  GAME_START_TIME_MS,
  GATEWAY_LOCATIONS,
  HACK_DIFFICULTY,
  PLAYER_DEFAULTS,
  TRACE_SPEED_SEC,
} from "./catalog";
import { generateCitizens } from "./records";
import { SeededRng } from "./rng";
import type {
  EmailMessage,
  LanNode,
  Mission,
  NewsItem,
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

function makeFiles(
  rng: SeededRng,
  companySlug: string,
  count: number,
  encryptedChance: number
): VirtualFile[] {
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

function makeCorporateLan(): LanNode[] {
  return [
    {
      id: "router",
      label: "Edge Router",
      kind: "router",
      x: 70,
      y: 130,
      visible: true,
      probed: true,
      unlocked: true,
      spoofed: false,
      connectedTo: ["hub_1"],
    },
    {
      id: "hub_1",
      label: "Core Hub",
      kind: "hub",
      x: 190,
      y: 130,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["router", "auth_1", "lock_1"],
    },
    {
      id: "auth_1",
      label: "Auth Server",
      kind: "auth_server",
      x: 190,
      y: 230,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["hub_1"],
    },
    {
      id: "lock_1",
      label: "Security Lock",
      kind: "lock",
      x: 330,
      y: 130,
      visible: false,
      probed: false,
      unlocked: false,
      spoofed: false,
      requiresNodeId: "auth_1",
      connectedTo: ["hub_1", "term_1", "main"],
    },
    {
      id: "term_1",
      label: "Ops Terminal",
      kind: "terminal",
      x: 330,
      y: 45,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["lock_1"],
    },
    {
      id: "main",
      label: "Main Server",
      kind: "main_server",
      x: 490,
      y: 130,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["lock_1"],
    },
  ];
}

export function createInitialWorld(handle: string, seed = 20100324): WorldState {
  const rng = new SeededRng(seed);
  const usedIps = new Set<string>(["127.0.0.1"]);
  const servers: Record<string, ServerNode> = {};
  const citizens = generateCitizens(rng, 12);
  const citizenList = Object.values(citizens);

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
    files: [{ id: "file_test_1", name: "Uplink_Test_Data.dat", sizeGq: 3, encryptedLevel: 0 }],
  });

  const gcd = addServer({
    name: "Global Criminal Database",
    companyName: "Interpol",
    kind: "database_criminal",
    x: 505,
    y: 150,
    discovered: true,
    adminPassword: "sentinel",
    security: [
      { kind: "monitor", level: 2, enabled: true, bypassed: false },
      { kind: "proxy", level: 2, enabled: true, bypassed: false },
    ],
  });

  const iad = addServer({
    name: "International Academic Database",
    companyName: "World Education Council",
    kind: "database_academic",
    x: 245,
    y: 195,
    discovered: true,
    adminPassword: "horizon",
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
  });

  const ssd = addServer({
    name: "Social Security Database",
    companyName: "Global Civil Registry",
    kind: "database_social",
    x: 215,
    y: 230,
    discovered: true,
    adminPassword: "cascade",
    security: [
      { kind: "monitor", level: 2, enabled: true, bypassed: false },
      { kind: "proxy", level: 1, enabled: true, bypassed: false },
    ],
  });

  const bank = addServer({
    name: "First International Bank",
    companyName: "First International Bank",
    kind: "bank",
    x: 515,
    y: 135,
    discovered: true,
    adminPassword: "vault",
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 3, enabled: true, bypassed: false },
    ],
  });

  const playerAccountNum = "1004921";
  bank.bankAccounts.push({
    accountNumber: playerAccountNum,
    ownerName: handle,
    password: "vault",
    balance: PLAYER_DEFAULTS.credits,
    loan: 0,
    statements: [],
  });

  // Add rich NPC bank accounts for heist missions
  for (let i = 0; i < 4; i++) {
    const cit = citizenList[i]!;
    bank.bankAccounts.push({
      accountNumber: String(2005100 + i * 137),
      ownerName: cit.fullName,
      password: rng.pick(PASSWORDS),
      balance: rng.int(12000, 85000),
      loan: rng.int(0, 5000),
      statements: [],
    });
  }

  // Storyline faction mainframes
  const arcMainframe = addServer({
    name: "ARC Central Mainframe",
    companyName: "Andromeda Research Corp",
    kind: "central_mainframe",
    x: 155,
    y: 215,
    discovered: false,
    adminPassword: "eclipse",
    security: [
      { kind: "monitor", level: 4, enabled: true, bypassed: false },
      { kind: "proxy", level: 4, enabled: true, bypassed: false },
      { kind: "firewall", level: 4, enabled: true, bypassed: false },
    ],
    files: [
      {
        id: "file_revelation_core",
        name: "Revelation_v1.0.dat",
        sizeGq: 4,
        encryptedLevel: 1,
        dataTag: "revelation",
      },
    ],
  });

  const arunmorMainframe = addServer({
    name: "Arunmor Central Mainframe",
    companyName: "Arunmor Corporation",
    kind: "central_mainframe",
    x: 860,
    y: 190,
    discovered: false,
    adminPassword: "valkyrie",
    security: [
      { kind: "monitor", level: 4, enabled: true, bypassed: false },
      { kind: "proxy", level: 4, enabled: true, bypassed: false },
      { kind: "firewall", level: 4, enabled: true, bypassed: false },
    ],
    files: [
      {
        id: "file_faith_core",
        name: "Faith_v1.0.dat",
        sizeGq: 4,
        encryptedLevel: 1,
        dataTag: "faith",
      },
    ],
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
      security.push({
        kind: "monitor",
        level: kind === "central_mainframe" ? 3 : 1,
        enabled: true,
        bypassed: false,
      });
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

  // Corporate LAN target
  const arcturusLan = addServer({
    name: "Arcturus Local Area Network",
    companyName: "Arcturus Defense",
    kind: "lan",
    x: 845,
    y: 255,
    discovered: true,
    adminPassword: "override",
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 2, enabled: true, bypassed: false },
    ],
    files: [
      { id: "file_lan_secret", name: "arcturus_prototype.dat", sizeGq: 4, encryptedLevel: 1 },
    ],
    lanNodes: makeCorporateLan(),
  });

  // Rich variety of initial contracts covering every mechanic
  const academicTarget = citizenList[4]!;
  const criminalTarget = citizenList.find((c) => c.criminalHistory.length > 0) ?? citizenList[5]!;
  const socialTarget = citizenList[6]!;
  const heistAccount = bank.bankAccounts[1]!;
  const internalTarget = corpNodes.find((n) => n.kind === "internal_services" && n.files.length > 0)!;
  const destroyTarget = corpNodes.filter((n) => n.kind === "internal_services" && n.files.length > 0)[1]!;

  const missions: Mission[] = [
    {
      id: "mission_tutorial",
      kind: "steal_file",
      title: "Uplink Test Contract",
      employer: "Uplink Corporation",
      description: `Connect to ${testMachine.name} (${testMachine.ip}), crack admin, copy Uplink_Test_Data.dat to your gateway, and wipe your bounce log at InterNIC.`,
      difficulty: 1,
      payment: 1500,
      minUplinkRating: 0,
      targetIp: testMachine.ip,
      targetFileName: "Uplink_Test_Data.dat",
      accepted: false,
      completed: false,
    },
    {
      id: "mission_academic_1",
      kind: "change_academic",
      title: `Boost Academic Record for ${academicTarget.fullName}`,
      employer: "Private Client",
      description: `Break into ${iad.name} (${iad.ip}) and raise ${academicTarget.fullName}'s GPA to 4.0.`,
      difficulty: 2,
      payment: 2200,
      minUplinkRating: 0,
      targetIp: iad.ip,
      targetCitizenId: academicTarget.id,
      targetValue: "4.0",
      accepted: false,
      completed: false,
    },
    {
      id: "mission_steal_1",
      kind: "steal_file",
      title: `Acquire Confidential Data from ${internalTarget.companyName}`,
      employer: "Vanguard Micro",
      description: `Infiltrate ${internalTarget.name} (${internalTarget.ip}) and copy ${internalTarget.files[0]!.name} (decrypt if encrypted) to your gateway.`,
      difficulty: 2,
      payment: 2400,
      minUplinkRating: 0,
      targetIp: internalTarget.ip,
      targetFileName: internalTarget.files[0]!.name,
      accepted: false,
      completed: false,
    },
    {
      id: "mission_destroy_1",
      kind: "destroy_file",
      title: `Sabotage Research at ${destroyTarget.companyName}`,
      employer: "Obsidian Systems",
      description: `Break into ${destroyTarget.name} (${destroyTarget.ip}) and delete ${destroyTarget.files[0]!.name}.`,
      difficulty: 3,
      payment: 2800,
      minUplinkRating: 0,
      targetIp: destroyTarget.ip,
      targetFileName: destroyTarget.files[0]!.name,
      accepted: false,
      completed: false,
    },
    {
      id: "mission_criminal_1",
      kind: "change_criminal",
      title: `Clear Criminal History for ${criminalTarget.fullName}`,
      employer: "Anonymous Syndicate",
      description: `Access ${gcd.name} (${gcd.ip}), bypass/disable Proxy, and clear ${criminalTarget.fullName}'s criminal record.`,
      difficulty: 4,
      payment: 4200,
      minUplinkRating: 2,
      targetIp: gcd.ip,
      targetCitizenId: criminalTarget.id,
      targetValue: "clear",
      accepted: false,
      completed: false,
    },
    {
      id: "mission_social_1",
      kind: "change_social",
      title: `Update Social Registry for ${socialTarget.fullName}`,
      employer: "Meridian Logistics",
      description: `Access ${ssd.name} (${ssd.ip}) and change ${socialTarget.fullName}'s employer to "Meridian Logistics".`,
      difficulty: 3,
      payment: 3200,
      minUplinkRating: 1,
      targetIp: ssd.ip,
      targetCitizenId: socialTarget.id,
      targetValue: "Meridian Logistics",
      accepted: false,
      completed: false,
    },
    {
      id: "mission_bank_1",
      kind: "bank_heist",
      title: `Siphon 5,000c from ${heistAccount.ownerName}`,
      employer: "Black Market Broker",
      description: `Crack account #${heistAccount.accountNumber} on ${bank.name} (${bank.ip}), wire at least 5,000c to your account (#${playerAccountNum}), and delete BOTH bank statements before the audit!`,
      difficulty: 5,
      payment: 5000,
      minUplinkRating: 2,
      targetIp: bank.ip,
      targetValue: heistAccount.accountNumber,
      targetAmount: 5000,
      accepted: false,
      completed: false,
    },
    {
      id: "mission_lan_1",
      kind: "lan_infiltration",
      title: `Infiltrate ${arcturusLan.name}`,
      employer: "Stratos Aerospace",
      description: `Scan and traverse ${arcturusLan.name} (${arcturusLan.ip}), spoof Auth Server or force the Security Lock, reach Main Server, and steal arcturus_prototype.dat (decrypt Level 1).`,
      difficulty: 6,
      payment: 8500,
      minUplinkRating: 4,
      targetIp: arcturusLan.ip,
      targetFileName: "arcturus_prototype.dat",
      accepted: false,
      completed: false,
    },
  ];

  const emails: EmailMessage[] = [
    {
      id: "email_welcome",
      from: "internal@uplink.net",
      subject: "Welcome to Uplink",
      body:
        `Agent ${handle},\n\n` +
        `Your Alpha Gateway in ${homeLoc.city} is online with 60 GHz CPU, 24 Gq memory, and 3,000 credits at ${bank.name} (Acct #${playerAccountNum}, pw: vault).\n\n` +
        `Field manual:\n` +
        `1. Always bounce through InterNIC (${internic.ip}) first, then several other nodes.\n` +
        `2. After any traced hack, reconnect to InterNIC (admin/admin) and erase your bounce log with Log Deleter v4.\n` +
        `3. Reach Novice rating (6+ score) to unlock the ARC vs. Arunmor storyline.\n\n` +
        `Check the Missions tab to accept your first contract.`,
      timestampMs: GAME_START_TIME_MS,
      read: false,
    },
  ];

  const news: NewsItem[] = [
    {
      id: "news_init_1",
      timestampMs: GAME_START_TIME_MS,
      headline: "Uplink Corporation Opens Q2 Freelance Agent Registry",
      body: `New remote gateways provisioned across 8 global hubs. Corporate security spending rises 18% amid growing cyber-espionage.`,
    },
    {
      id: "news_init_2",
      timestampMs: GAME_START_TIME_MS,
      headline: "Andromeda Research Corp Announces Secret Next-Gen AI Initiative",
      body: `ARC declined to comment on rumors surrounding internal project codenamed 'Revelation'.`,
    },
  ];

  return {
    schemaVersion: 2,
    seed,
    rngState: rng.getState(),
    timeMs: GAME_START_TIME_MS,
    timeScale: 1,
    player: {
      handle,
      credits: PLAYER_DEFAULTS.credits,
      bankIp: bank.ip,
      bankAccountNumber: playerAccountNum,
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
      savedBounceRoute: [internic.ip, uplinkInternal.ip],
    },
    servers,
    citizens,
    connection: {
      route: [playerIp],
      connected: false,
      authenticatedAs: "none",
      traceActive: false,
      traceHopsCompleted: 0,
      secondsUntilNextHop: 0,
      totalTraceSecondsRemaining: 0,
      totalTraceSecondsInitial: 0,
      lanSession: null,
    },
    tasks: [],
    missions,
    emails,
    news,
    story: {
      stage: "dormant",
      faction: "none",
      revelationCount: 0,
      faithCount: 0,
      arcServerIp: arcMainframe.ip,
      arunmorServerIp: arunmorMainframe.ip,
    },
    scheduledEvents: [],
    idCounter: 200,
  };
}
