import {
  FIXED_IPS,
  GAME_START_TIME_MS,
  GATEWAY_LOCATIONS,
  HACK_DIFFICULTY,
  PLAYER_DEFAULTS,
  TRACE_SPEED_SEC,
} from "./catalog";
import { createInitialConsole } from "./console";
import { COMPANY_NAMES, generateCitizens, generateCompanies } from "./records";
import { SeededRng } from "./rng";
import type {
  EmailMessage,
  LanNode,
  Mission,
  NewsItem,
  ServerKind,
  ServerNode,
  TraceActionKind,
  VirtualFile,
  WorldState,
} from "./types";

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

const BANK_NAMES = [
  { name: "Uplink International Bank", x: 485, y: 140 },
  { name: "First International Bank", x: 525, y: 135 },
  { name: "Geneva Global Trust", x: 505, y: 165 },
  { name: "Pacific Reserve Bank", x: 840, y: 215 },
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
    const encryptedLevel = rng.chance(encryptedChance) ? rng.int(1, 5) : 0;
    files.push({
      id: `file_${companySlug}_${i}_${num}`,
      name: `${companySlug}_${prefix}_${num}.dat`,
      sizeGq: rng.int(2, 8),
      encryptedLevel,
    });
  }
  return files;
}

function makeArcturusLan(): LanNode[] {
  return [
    {
      id: "router",
      label: "Edge Router",
      kind: "router",
      x: 60,
      y: 135,
      security: 1,
      subnet: 101,
      visibility: 3,
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
      x: 165,
      y: 135,
      security: 1,
      subnet: 102,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["router", "auth_1", "lock_1", "bridge_1"],
    },
    {
      id: "auth_1",
      label: "Auth Server",
      kind: "auth_server",
      x: 165,
      y: 230,
      security: 1,
      subnet: 103,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["hub_1"],
    },
    {
      id: "bridge_1",
      label: "Isolation Bridge",
      kind: "isolation_bridge",
      x: 270,
      y: 50,
      security: 1,
      subnet: 104,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      bridgeLocks: ["lock_1", "lock_2"],
      connectedTo: ["hub_1", "term_1"],
    },
    {
      id: "lock_1",
      label: "Security Lock A",
      kind: "lock",
      x: 295,
      y: 135,
      security: 1,
      subnet: 105,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: false,
      spoofed: false,
      requiresNodeId: "auth_1",
      connectedTo: ["hub_1", "term_1", "lock_2"],
    },
    {
      id: "term_1",
      label: "Ops Terminal",
      kind: "terminal",
      x: 375,
      y: 50,
      security: 1,
      subnet: 106,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["bridge_1", "lock_1"],
    },
    {
      id: "lock_2",
      label: "Vault Lock B",
      kind: "lock",
      x: 410,
      y: 135,
      security: 2,
      subnet: 107,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      requiresNodeId: "auth_1",
      connectedTo: ["lock_1", "main"],
    },
    {
      id: "main",
      label: "Main Server",
      kind: "main_server",
      x: 505,
      y: 135,
      security: 2,
      subnet: 108,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["lock_2"],
    },
  ];
}

function makeDarwinLan(): LanNode[] {
  return [
    {
      id: "d_router",
      label: "Edge Router",
      kind: "router",
      x: 60,
      y: 135,
      security: 1,
      subnet: 201,
      visibility: 3,
      visible: true,
      probed: true,
      unlocked: true,
      spoofed: false,
      connectedTo: ["d_hub"],
    },
    {
      id: "d_hub",
      label: "Switch Hub",
      kind: "switch",
      x: 170,
      y: 135,
      security: 1,
      subnet: 202,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["d_router", "d_tx", "d_term"],
    },
    {
      id: "d_term",
      label: "RF Notes Terminal",
      kind: "terminal",
      x: 170,
      y: 48,
      security: 1,
      subnet: 203,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["d_hub"],
    },
    {
      id: "d_tx",
      label: "Radio Transmitter",
      kind: "radio_transmitter",
      x: 280,
      y: 135,
      security: 2,
      subnet: 204,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["d_hub"],
    },
    {
      id: "d_rx",
      label: "Radio Receiver (162.4)",
      kind: "radio_receiver",
      x: 390,
      y: 135,
      security: 2,
      subnet: 205,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      radioFreqMhz: 162.4,
      connectedTo: ["d_main"],
    },
    {
      id: "d_main",
      label: "Main Server",
      kind: "main_server",
      x: 505,
      y: 135,
      security: 3,
      subnet: 206,
      visibility: 0,
      visible: false,
      probed: false,
      unlocked: true,
      spoofed: false,
      connectedTo: ["d_rx"],
    },
  ];
}

export function createInitialWorld(handle: string, seed = 20100324): WorldState {
  const rng = new SeededRng(seed);
  const usedIps = new Set<string>(Object.values(FIXED_IPS));
  const servers: Record<string, ServerNode> = {};
  const citizens = generateCitizens(rng, 20);
  const citizenList = Object.values(citizens);
  const companies = generateCompanies(rng, citizens);
  const companyList = Object.values(companies);

  const homeLoc = GATEWAY_LOCATIONS[0]!; // London
  const playerIp = FIXED_IPS.LOCALHOST;

  const addServer = (params: {
    ip?: string;
    name: string;
    companyName: string;
    kind: ServerKind;
    x: number;
    y: number;
    discovered: boolean;
    playerAccess?: "none" | "user" | "admin";
    adminPassword?: string;
    traceAction?: TraceActionKind;
    requiresCypher?: boolean;
    cypherLevel?: number;
    requiresVoiceAuth?: boolean;
    voiceAdminName?: string;
    voicePhoneNumber?: string;
    security?: ServerNode["security"];
    files?: VirtualFile[];
    lanNodes?: LanNode[];
  }): ServerNode => {
    const ip = params.ip ?? makeIp(rng, usedIps);
    usedIps.add(ip);
    const defaultTraceAction: TraceActionKind =
      params.kind === "public_access" || params.kind === "uplink_public"
        ? "none"
        : params.kind === "uplink_test"
          ? "warning_mail"
          : params.kind === "internal_services" || params.kind === "database_academic" || params.kind === "database_medical"
            ? "fine"
            : params.kind === "bank" || params.kind === "uplink_internal"
              ? "tactical"
              : "legal";

    const node: ServerNode = {
      ip,
      name: params.name,
      companyName: params.companyName,
      kind: params.kind,
      x: params.x,
      y: params.y,
      traceSpeedSec: TRACE_SPEED_SEC[params.kind],
      traceAction: params.traceAction ?? defaultTraceAction,
      hackDifficulty: HACK_DIFFICULTY[params.kind],
      discovered: params.discovered,
      playerAccess: params.playerAccess ?? "none",
      sysIntact: true,
      destroyed: false,
      probedLevel: 0,
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
      ...(params.requiresCypher ? { requiresCypher: true, cypherLevel: params.cypherLevel ?? 1 } : {}),
      ...(params.requiresVoiceAuth
        ? {
            requiresVoiceAuth: true,
            voiceAdminName: params.voiceAdminName ?? "System Administrator",
            voicePhoneNumber: params.voicePhoneNumber ?? "+44-0171-555019",
          }
        : {}),
      ...(params.lanNodes ? { lanNodes: params.lanNodes } : {}),
    };
    servers[ip] = node;
    return node;
  };

  // Canonical Fixed Uplink Infrastructure (exact IPs from data.h)
  const internic = addServer({
    ip: FIXED_IPS.INTERNIC,
    name: "InterNIC",
    companyName: "InterNIC",
    kind: "internic",
    x: 285,
    y: 175,
    discovered: true,
    playerAccess: "admin",
    adminPassword: "admin",
    traceAction: "warning_mail",
    security: [],
  });

  const uplinkPublic = addServer({
    ip: FIXED_IPS.UPLINK_PUBLIC,
    name: "Uplink Public Access Server",
    companyName: "Uplink Corporation",
    kind: "uplink_public",
    x: 455,
    y: 112,
    discovered: true,
    playerAccess: "user",
    traceAction: "none",
    security: [],
  });

  const uplinkInternal = addServer({
    ip: FIXED_IPS.UPLINK_INTERNAL,
    name: "Uplink Internal Services System",
    companyName: "Uplink Corporation",
    kind: "uplink_internal",
    x: 475,
    y: 125,
    discovered: true,
    playerAccess: "user",
    traceAction: "tactical",
    security: [
      { kind: "monitor", level: 5, enabled: true, bypassed: false },
      { kind: "proxy", level: 5, enabled: true, bypassed: false },
      { kind: "firewall", level: 5, enabled: true, bypassed: false },
    ],
  });

  const testMachine = addServer({
    ip: FIXED_IPS.UPLINK_TEST,
    name: "Uplink Test Machine",
    companyName: "Uplink Corporation",
    kind: "uplink_test",
    x: 430,
    y: 155,
    discovered: true,
    adminPassword: "rosebud",
    traceAction: "warning_mail",
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
    files: [{ id: "file_test_1", name: "Uplink_Test_Data.dat", sizeGq: 3, encryptedLevel: 0 }],
  });

  const gcd = addServer({
    ip: FIXED_IPS.CRIMINAL_DB,
    name: "Global Criminal Database",
    companyName: "Interpol",
    kind: "database_criminal",
    x: 505,
    y: 150,
    discovered: true,
    adminPassword: "sentinel",
    traceAction: "legal",
    security: [
      { kind: "monitor", level: 2, enabled: true, bypassed: false },
      { kind: "proxy", level: 2, enabled: true, bypassed: false },
    ],
  });

  const iad = addServer({
    ip: FIXED_IPS.ACADEMIC_DB,
    name: "International Academic Database",
    companyName: "World Education Council",
    kind: "database_academic",
    x: 245,
    y: 195,
    discovered: true,
    adminPassword: "horizon",
    traceAction: "fine",
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
  });

  const ssd = addServer({
    ip: FIXED_IPS.SOCIAL_SECURITY_DB,
    name: "International Social Security Database",
    companyName: "Global Civil Registry",
    kind: "database_social",
    x: 215,
    y: 230,
    discovered: true,
    adminPassword: "cascade",
    traceAction: "legal",
    security: [
      { kind: "monitor", level: 2, enabled: true, bypassed: false },
      { kind: "proxy", level: 1, enabled: true, bypassed: false },
    ],
  });

  const cmd = addServer({
    ip: FIXED_IPS.MEDICAL_DB,
    name: "Central Medical Database",
    companyName: "World Health Registry",
    kind: "database_medical",
    x: 535,
    y: 175,
    discovered: true,
    adminPassword: "mercury",
    traceAction: "fine",
    security: [{ kind: "monitor", level: 1, enabled: true, bypassed: false }],
  });

  const stockMarket = addServer({
    ip: FIXED_IPS.STOCK_MARKET,
    name: "International Stock Market System",
    companyName: "Global Exchange",
    kind: "stock_market",
    x: 270,
    y: 185,
    discovered: true,
    playerAccess: "user",
    adminPassword: "vector",
    traceAction: "fine",
    security: [{ kind: "monitor", level: 2, enabled: true, bypassed: false }],
  });

  addServer({
    ip: FIXED_IPS.PROTOVISION,
    name: "Protovision Game Server",
    companyName: "Protovision",
    kind: "protovision",
    x: 178,
    y: 192,
    discovered: false,
    adminPassword: "joshua",
    traceAction: "none",
    security: [],
  });

  // Multiple International Banks (original has NUM_STARTING_BANKS)
  const banks: ServerNode[] = [];
  for (let b = 0; b < BANK_NAMES.length; b++) {
    const meta = BANK_NAMES[b]!;
    const bankNode = addServer({
      name: meta.name,
      companyName: meta.name,
      kind: "bank",
      x: meta.x,
      y: meta.y,
      discovered: b < 2,
      adminPassword: rng.pick(PASSWORDS),
      traceAction: "tactical",
      security: [
        { kind: "monitor", level: 3, enabled: true, bypassed: false },
        { kind: "proxy", level: 3, enabled: true, bypassed: false },
      ],
    });
    for (let j = 0; j < 3; j++) {
      const cit = citizenList[(b * 3 + j) % citizenList.length]!;
      bankNode.bankAccounts.push({
        accountNumber: String(2005100 + b * 1000 + j * 137),
        ownerName: cit.fullName,
        password: rng.pick(PASSWORDS),
        balance: rng.int(12000, 95000),
        loan: rng.int(0, 5000),
        creditRating: rng.int(8, 13),
        statements: [],
      });
    }
    banks.push(bankNode);
  }

  const primaryBank = banks[0]!;
  const playerAccountNum = "1004921";
  primaryBank.bankAccounts.unshift({
    accountNumber: playerAccountNum,
    ownerName: handle,
    password: "vault",
    balance: PLAYER_DEFAULTS.credits,
    loan: 0,
    creditRating: PLAYER_DEFAULTS.creditRating,
    statements: [],
  });

  // Storyline faction mainframes
  const arcMainframe = addServer({
    name: "ARC Central Mainframe",
    companyName: "Andromeda Research Corp",
    kind: "central_mainframe",
    x: 155,
    y: 215,
    discovered: false,
    adminPassword: "eclipse",
    traceAction: "tactical",
    requiresCypher: true,
    cypherLevel: 2,
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
        version: 1.0,
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
    traceAction: "tactical",
    requiresCypher: true,
    cypherLevel: 2,
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
        version: 1.0,
      },
    ],
  });

  // Procedural corporate servers across the globe
  const corpNodes: ServerNode[] = [];
  for (let i = 0; i < 12; i++) {
    const companyName = COMPANY_NAMES[i]!;
    const comp = companyList[i]!;
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
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

    const ceo = citizenList[i % citizenList.length]!;
    const node = addServer({
      name:
        kind === "public_access"
          ? `${companyName} Public Access Server`
          : kind === "central_mainframe"
            ? `${companyName} Central Mainframe`
            : `${companyName} Internal Services Machine`,
      companyName,
      kind,
      x,
      y,
      discovered: i < 5,
      requiresCypher: kind === "central_mainframe",
      cypherLevel: 1,
      requiresVoiceAuth: kind === "central_mainframe",
      voiceAdminName: ceo.fullName,
      voicePhoneNumber: ceo.phoneNumber,
      security,
      files: makeFiles(rng, slug, rng.int(2, 4), kind === "central_mainframe" ? 0.5 : 0.15),
    });
    if (kind === "public_access") {
      comp.publicServerIp = node.ip;
    }
    corpNodes.push(node);
  }

  // Corporate LAN targets
  const arcturusLan = addServer({
    name: "Arcturus Local Area Network",
    companyName: "Arcturus Defense",
    kind: "lan",
    x: 845,
    y: 255,
    discovered: true,
    adminPassword: "override",
    traceAction: "legal",
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 2, enabled: true, bypassed: false },
    ],
    files: [
      { id: "file_lan_secret", name: "arcturus_prototype.dat", sizeGq: 4, encryptedLevel: 1 },
    ],
    lanNodes: makeArcturusLan(),
  });

  const darwinLan = addServer({
    name: "Darwin Digital LAN",
    companyName: "Darwin Digital",
    kind: "lan",
    x: 740,
    y: 295,
    discovered: false,
    adminPassword: "nexus",
    traceAction: "legal",
    security: [
      { kind: "monitor", level: 3, enabled: true, bypassed: false },
      { kind: "proxy", level: 3, enabled: true, bypassed: false },
    ],
    files: [
      { id: "file_darwin_core", name: "darwin_ai_core.dat", sizeGq: 6, encryptedLevel: 2 },
    ],
    lanNodes: makeDarwinLan(),
  });

  // Rich initial contract board covering all Uplink mission archetypes
  const academicTarget = citizenList[4]!;
  const criminalTarget = citizenList.find((c) => c.criminalHistory.length > 0) ?? citizenList[5]!;
  const socialTarget = citizenList[6]!;
  const medicalTarget = citizenList[7]!;
  const frameTarget = citizenList[8]!;
  const heistAccount = primaryBank.bankAccounts[1]!;
  const internalTarget = corpNodes.find((n) => n.kind === "internal_services" && n.files.length > 0)!;
  const destroyTarget = corpNodes.filter((n) => n.kind === "internal_services" && n.files.length > 0)[1]!;
  const removeTarget = corpNodes.filter((n) => n.kind === "internal_services")[2] ?? internalTarget;

  const missions: Mission[] = [
    {
      id: "mission_tutorial",
      kind: "steal_file",
      title: "Uplink Test Contract",
      employer: "Uplink Corporation",
      description: `Connect to ${testMachine.name} (${testMachine.ip}), crack admin, copy Uplink_Test_Data.dat to your gateway, and wipe your bounce log at InterNIC (${internic.ip}).`,
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
      id: "mission_medical_1",
      kind: "change_medical",
      title: `Alter Medical Record for ${medicalTarget.fullName}`,
      employer: "Novus Pharma",
      description: `Access ${cmd.name} (${cmd.ip}) and update ${medicalTarget.fullName}'s medical history to "Cleared for Orbital Duty".`,
      difficulty: 3,
      payment: 3000,
      minUplinkRating: 0,
      targetIp: cmd.ip,
      targetCitizenId: medicalTarget.id,
      targetValue: "Cleared for Orbital Duty",
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
      id: "mission_criminal_1",
      kind: "change_criminal",
      title: `Clear Criminal History for ${criminalTarget.fullName}`,
      employer: "Anonymous Syndicate",
      description: `Access ${gcd.name} (${gcd.ip}), bypass or disable Proxy, and clear ${criminalTarget.fullName}'s criminal record.`,
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
      id: "mission_remove_comp_1",
      kind: "remove_computer",
      title: `Destroy ${removeTarget.companyName} Internal Server`,
      employer: "Helios Dynamics",
      description: `Gain admin on ${removeTarget.name} (${removeTarget.ip}), open the Remote Console, run 'cd sys', 'delete', then 'shutdown' to wipe the host permanently.`,
      difficulty: 5,
      payment: 6400,
      minUplinkRating: 2,
      targetIp: removeTarget.ip,
      accepted: false,
      completed: false,
    },
    {
      id: "mission_frame_1",
      kind: "frame_user",
      title: `Frame ${frameTarget.fullName} for Cyber Intrusion`,
      employer: "Pinnacle Media",
      description: `Break into ${gcd.name} (${gcd.ip}), add a felony conviction to ${frameTarget.fullName}, and authorize an arrest warrant.`,
      difficulty: 6,
      payment: 7500,
      minUplinkRating: 3,
      targetIp: gcd.ip,
      targetCitizenId: frameTarget.id,
      accepted: false,
      completed: false,
    },
    {
      id: "mission_bank_1",
      kind: "bank_heist",
      title: `Siphon 5,000c from ${heistAccount.ownerName}`,
      employer: "Black Market Broker",
      description: `Crack account #${heistAccount.accountNumber} on ${primaryBank.name} (${primaryBank.ip}), wire at least 5,000c to your account (#${playerAccountNum}), and delete BOTH bank statements within 2 minutes!`,
      difficulty: 5,
      payment: 5000,
      minUplinkRating: 2,
      targetIp: primaryBank.ip,
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
      description: `Scan and traverse ${arcturusLan.name} (${arcturusLan.ip}), spoof Auth Server or toggle the Isolation Bridge, reach Main Server, and steal arcturus_prototype.dat (decrypt Level 1).`,
      difficulty: 6,
      payment: 8500,
      minUplinkRating: 4,
      targetIp: arcturusLan.ip,
      targetFileName: "arcturus_prototype.dat",
      accepted: false,
      completed: false,
    },
    {
      id: "mission_lan_2",
      kind: "lan_infiltration",
      title: `Breach ${darwinLan.name} RF Subnetwork`,
      employer: "Vanguard Micro",
      description: `Connect to ${darwinLan.name} (${darwinLan.ip}), reach Radio Transmitter, tune frequency to 162.4 GHz to bridge into Radio Receiver, and extract darwin_ai_core.dat.`,
      difficulty: 7,
      payment: 12000,
      minUplinkRating: 5,
      targetIp: darwinLan.ip,
      targetFileName: "darwin_ai_core.dat",
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
        `Your Alpha Gateway in ${homeLoc.city} is online with 60 GHz CPU, 24 Gq memory, 1 Gq/s modem, and 3,000c at ${primaryBank.name} (Acct #${playerAccountNum}, pw: vault).\n\n` +
        `Operational briefing:\n` +
        `1. Route through InterNIC (${internic.ip}) first, followed by additional bounce nodes.\n` +
        `2. After any traced intrusion, reconnect to InterNIC (admin/admin) and erase your bounce log with Log Deleter v4.\n` +
        `3. Trade corporate equities on the International Stock Market (${stockMarket.ip}) or take bank loans when upgrading your rig.\n` +
        `4. Reach Novice rating (6+ score) to unlock the ARC vs. Arunmor storyline.\n\n` +
        `Open the Missions board to accept your first contract.`,
      timestampMs: GAME_START_TIME_MS,
      read: false,
    },
  ];

  const news: NewsItem[] = [
    {
      id: "news_init_1",
      timestampMs: GAME_START_TIME_MS,
      headline: "Uplink Corporation Opens Q2 Freelance Agent Registry",
      body: `Remote gateways provisioned across 8 global hubs. Uplink Public Access (${uplinkPublic.ip}) and InterNIC (${internic.ip}) report record traffic.`,
    },
    {
      id: "news_init_2",
      timestampMs: GAME_START_TIME_MS,
      headline: "Andromeda Research Corp Announces Classified AI Initiative",
      body: `ARC declined to comment on rumors surrounding an internal research program codenamed 'Revelation'.`,
    },
  ];

  return {
    schemaVersion: 3,
    seed,
    rngState: rng.getState(),
    timeMs: GAME_START_TIME_MS,
    timeScale: 1,
    player: {
      handle,
      credits: PLAYER_DEFAULTS.credits,
      bankIp: primaryBank.ip,
      bankAccountNumber: playerAccountNum,
      uplinkScore: PLAYER_DEFAULTS.uplinkScore,
      neuromancerScore: PLAYER_DEFAULTS.neuromancerScore,
      disavowed: false,
      gateway: {
        specId: "alpha",
        gatewayIdNumber: 1,
        locationCity: homeLoc.city,
        ip: playerIp,
        x: homeLoc.x,
        y: homeLoc.y,
        cpusGhz: [PLAYER_DEFAULTS.startCpuGhz],
        memoryTotalGq: PLAYER_DEFAULTS.startMemoryGq,
        modemGbps: PLAYER_DEFAULTS.startBandwidthGbps,
        bandwidthGbps: PLAYER_DEFAULTS.startBandwidthGbps,
        securityDevices: [],
        proximityAlert: 0,
        nukedCount: 0,
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
      portfolio: [],
    },
    companies,
    servers,
    citizens,
    connection: {
      route: [playerIp],
      connected: false,
      authenticatedAs: "none",
      cypherPassed: false,
      voicePassed: false,
      traceActive: false,
      traceHopsCompleted: 0,
      secondsUntilNextHop: 0,
      totalTraceSecondsRemaining: 0,
      totalTraceSecondsInitial: 0,
      lanSession: null,
      console: createInitialConsole(),
    },
    tasks: [],
    missions,
    emails,
    news,
    story: {
      stage: "dormant",
      faction: "none",
      act: 1,
      scene: 1,
      revelationVersion: 1.0,
      faithVersion: 1.0,
      revelationCount: 0,
      faithCount: 0,
      arcServerIp: arcMainframe.ip,
      arunmorServerIp: arunmorMainframe.ip,
      completedSpecialMissions: [],
    },
    scheduledEvents: [
      {
        id: "evt_mission_refresh_init",
        triggerAtMs: GAME_START_TIME_MS + 12 * 3600 * 1000,
        kind: "mission_refresh",
        payload: {},
      },
      {
        id: "evt_monthly_billing_init",
        triggerAtMs: GAME_START_TIME_MS + 30 * 24 * 3600 * 1000,
        kind: "monthly_billing",
        payload: {},
      },
    ],
    idCounter: 300,
  };
}
