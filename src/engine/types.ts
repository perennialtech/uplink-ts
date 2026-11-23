export type ServerKind =
  | "public_access"
  | "internal_services"
  | "central_mainframe"
  | "bank"
  | "database_criminal"
  | "database_academic"
  | "database_social"
  | "database_medical"
  | "stock_market"
  | "internic"
  | "uplink_public"
  | "uplink_internal"
  | "uplink_test"
  | "protovision"
  | "lan";

export type AccessLevel = "none" | "user" | "admin";

export type SecurityKind = "monitor" | "proxy" | "firewall" | "encryption";

export interface SecuritySystem {
  kind: SecurityKind;
  level: number; // 1..5
  enabled: boolean;
  bypassed: boolean;
}

export type TraceActionKind = "none" | "disconnect" | "warning_mail" | "fine" | "legal" | "tactical";

export interface VirtualFile {
  id: string;
  name: string;
  sizeGq: number; // Gigaquads
  encryptedLevel: number; // 0 = plaintext, 1..7 = encrypted
  dataTag?: "revelation" | "faith" | "mission" | "system";
  version?: number;
}

export interface LogEntry {
  id: string;
  timestampMs: number;
  type:
    | "connection"
    | "bounce"
    | "login"
    | "file_copied"
    | "file_deleted"
    | "admin_action"
    | "bank_transfer"
    | "deleted"
    | "overwritten";
  fromIp: string;
  toIp?: string;
  detail: string;
  /** True if erased by Log Deleter v1-v3 (recoverable by Log Undeleter) */
  suspiciousDeletion: boolean;
  /** Deletion tier used (1=blanked, 2=space left, 3=overwritten with decoy) */
  deletionTier?: 1 | 2 | 3;
  originalDetail?: string;
  originalFromIp?: string;
  originalToIp?: string;
}

export interface UserAccount {
  username: string;
  password: string;
  securityLevel: number; // 1 = admin, 2..10 = lower privilege
}

export interface BankStatement {
  id: string;
  timestampMs: number;
  amount: number; // negative = outgoing, positive = incoming
  counterpartyIp: string;
  counterpartyAccount: string;
  note: string;
}

export interface BankAccount {
  accountNumber: string;
  ownerName: string;
  password: string;
  balance: number;
  loan: number;
  creditRating: number; // 1..15
  statements: BankStatement[];
}

export interface CitizenRecord {
  id: string;
  fullName: string;
  ssn: string;
  degree: string;
  gpa: string;
  criminalHistory: string[];
  arrestWarrant: boolean;
  employment: string;
  deceased: boolean;
  medicalHistory: string[];
  bloodType: string;
  phoneNumber: string;
  voiceSampleId: string;
}

export interface CompanyInfo {
  id: string;
  name: string;
  ceoName: string;
  size: number; // 1..50
  growth: number; // -20..40%
  alignment: number; // -50..50
  shareHistory: number[]; // 12 monthly prices
  currentSharePrice: number;
  publicServerIp?: string;
}

export interface StockHolding {
  companyId: string;
  shares: number;
  avgPurchasePrice: number;
}

export type LanNodeKind =
  | "router"
  | "hub"
  | "switch"
  | "terminal"
  | "lock"
  | "auth_server"
  | "isolation_bridge"
  | "modem"
  | "radio_transmitter"
  | "radio_receiver"
  | "log_server"
  | "main_server";

/** Original Uplink LAN visibility tiers: 0=NONE, 1=AWARE, 2=TYPE, 3=FULL */
export type LanVisibility = 0 | 1 | 2 | 3;

export interface LanNode {
  id: string;
  label: string;
  kind: LanNodeKind;
  x: number;
  y: number;
  security: number; // 1..3
  subnet: number;
  visibility: LanVisibility;
  visible: boolean;
  probed: boolean;
  unlocked: boolean;
  spoofed: boolean;
  /** Optional ID of auth_server or terminal that unlocks/spoofs this node */
  requiresNodeId?: string;
  /** For isolation_bridge: toggles between two lock IDs */
  bridgeLocks?: [string, string];
  /** For radio_receiver: target frequency in MHz (140.0..180.0) */
  radioFreqMhz?: number;
  /** For modem: phone number to dial directly */
  modemPhone?: string;
  connectedTo: string[];
}

export interface LanSession {
  serverIp: string;
  currentNodeId: string;
  sysadminNodeId: string | null;
  sysadminAlerted: boolean;
  sysadminStepTimerSec: number;
  tunedFreqMhz: number;
  spoofedNodeIds: string[];
}

export interface ConsoleState {
  currentDir: "/" | "pub" | "usr" | "log" | "rec" | "sys";
  lines: string[];
}

export interface ServerNode {
  ip: string;
  name: string;
  companyName: string;
  kind: ServerKind;
  /** Normalized map coordinates (0..1000 x 0..500) */
  x: number;
  y: number;
  /** Base seconds to trace a single hop; -1 means no active trace */
  traceSpeedSec: number;
  /** Consequence severity when traced on this server */
  traceAction: TraceActionKind;
  /** Base ticks per password character */
  hackDifficulty: number;
  /** Whether the player knows this IP in their link list */
  discovered: boolean;
  /** Highest known access level for bounce-delay bonuses */
  playerAccess: AccessLevel;
  /** Whether system files (/sys) are intact; if false + shutdown, server is destroyed */
  sysIntact: boolean;
  /** True if destroyed via console delete sys + shutdown */
  destroyed: boolean;
  /** High-security auth gates required in addition to password */
  requiresCypher?: boolean;
  cypherLevel?: number; // 1..3
  requiresVoiceAuth?: boolean;
  voiceAdminName?: string;
  voicePhoneNumber?: string;
  /** Security probe reveal tier (0=unprobed, 1=types, 2=versions, 3=status) */
  probedLevel: number;
  security: SecuritySystem[];
  accounts: UserAccount[];
  files: VirtualFile[];
  logs: LogEntry[];
  bankAccounts: BankAccount[];
  lanNodes?: LanNode[];
  /** Infected by ARC's Revelation virus */
  revelationInfected?: boolean;
  revelationVersion?: number;
  /** Protected/purged by Arunmor's Faith */
  faithProtected?: boolean;
  faithVersion?: number;
}

export type SoftwareCategory =
  | "cracker"
  | "bypasser"
  | "file_util"
  | "security"
  | "lan"
  | "hud"
  | "other"
  | "virus";

export type SoftwareId =
  | "password_breaker"
  | "dictionary_hacker"
  | "decypher"
  | "voice_analyser"
  | "trace_tracker"
  | "log_deleter"
  | "log_undeleter"
  | "log_modifier"
  | "file_copier"
  | "file_deleter"
  | "defrag"
  | "decrypter"
  | "ip_lookup"
  | "ip_probe"
  | "proxy_bypass"
  | "proxy_disable"
  | "firewall_bypass"
  | "firewall_disable"
  | "monitor_bypass"
  | "hud_map_show_trace"
  | "hud_connection_analysis"
  | "hud_lan_view"
  | "hud_irc_client"
  | "lan_scan"
  | "lan_probe"
  | "lan_spoof"
  | "lan_force"
  | "revelation"
  | "revelation_tracker"
  | "faith";

export interface SoftwareDefinition {
  id: SoftwareId;
  name: string;
  version: number;
  category: SoftwareCategory;
  cost: number;
  sizeGq: number;
  description: string;
}

export interface InstalledSoftware {
  id: SoftwareId;
  version: number;
  sizeGq: number;
}

export interface GatewaySpec {
  id: string;
  name: string;
  cost: number;
  maxCpus: number;
  maxMemoryGq: number;
  maxSecuritySlots: number;
  bandwidthGbps: number;
  /** Virtuanet gateway grants total trace anonymity */
  anonymous?: boolean;
  description: string;
}

export interface CpuSpec {
  id: string;
  name: string;
  ghz: number;
  cost: number;
}

export interface ModemSpec {
  id: string;
  name: string;
  gbps: number;
  cost: number;
}

export interface MemorySpec {
  id: string;
  name: string;
  gq: number;
  cost: number;
}

export type GatewaySecurityDevice = "motion_sensor" | "self_destruct";

export interface GatewaySecuritySpec {
  id: GatewaySecurityDevice;
  name: string;
  cost: number;
  slots: number;
  description: string;
}

export interface PlayerGateway {
  specId: string;
  gatewayIdNumber: number;
  locationCity: string;
  ip: string;
  x: number;
  y: number;
  cpusGhz: number[];
  memoryTotalGq: number;
  modemGbps: number;
  bandwidthGbps: number;
  securityDevices: GatewaySecurityDevice[];
  /** Number of feds/engineers currently near the gateway (Motion Sensor) */
  proximityAlert: number;
  nukedCount: number;
  files: VirtualFile[];
  software: InstalledSoftware[];
}

export interface ConnectionState {
  /** Ordered bounce path: [playerGatewayIp, ...bounces, targetIp] */
  route: string[];
  connected: boolean;
  authenticatedAs: AccessLevel;
  authenticatedUser?: string;
  authenticatedBankAccount?: string;
  cypherPassed: boolean;
  voicePassed: boolean;
  traceActive: boolean;
  /** Number of hops traced so far (0..route.length - 1) */
  traceHopsCompleted: number;
  /** Seconds remaining until the next hop is traced */
  secondsUntilNextHop: number;
  /** Total estimated seconds remaining for full trace */
  totalTraceSecondsRemaining: number;
  /** Total trace duration at start for percentage readout */
  totalTraceSecondsInitial: number;
  lanSession: LanSession | null;
  console: ConsoleState;
}

export type TaskKind =
  | "password_breaker"
  | "dictionary_hacker"
  | "decypher"
  | "voice_analyser"
  | "trace_tracker"
  | "file_copier"
  | "file_deleter"
  | "defrag"
  | "decrypter"
  | "ip_lookup"
  | "ip_probe"
  | "log_deleter"
  | "log_undeleter"
  | "log_modifier"
  | "proxy_disable"
  | "firewall_disable"
  | "proxy_bypass"
  | "firewall_bypass"
  | "monitor_bypass"
  | "lan_scan"
  | "lan_probe"
  | "lan_spoof"
  | "lan_force";

export interface RunningTask {
  id: string;
  kind: TaskKind;
  version: number;
  targetIp: string;
  targetRef?: string; // username, fileId, logId, or lanNodeId
  /** Relative priority weight (1..10); scheduler normalizes across all running tasks */
  cpuWeight: number;
  /** Computed live GHz share assigned by scheduler */
  allocatedGhz: number;
  /** Progress 0..1 */
  progress: number;
  /** Visual status line */
  statusText: string;
  completed: boolean;
  /** Persistent tools (bypasses, trace tracker) stay active until stopped */
  persistent: boolean;
  meta?: Record<string, string | number | boolean>;
}

export type MissionKind =
  | "steal_file"
  | "destroy_file"
  | "find_data"
  | "change_academic"
  | "change_criminal"
  | "change_social"
  | "change_medical"
  | "bank_heist"
  | "remove_computer"
  | "frame_user"
  | "trace_user"
  | "remove_user"
  | "lan_infiltration"
  | "pay_fine"
  | "story_special";

export interface Mission {
  id: string;
  kind: MissionKind;
  title: string;
  employer: string;
  description: string;
  difficulty: number;
  payment: number;
  minUplinkRating: number;
  targetIp: string;
  targetFileName?: string;
  targetCitizenId?: string;
  targetValue?: string;
  targetAmount?: number;
  dueDateMs?: number;
  specialMissionCode?: string;
  accepted: boolean;
  completed: boolean;
  failed?: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  timestampMs: number;
  read: boolean;
  missionId?: string;
}

export interface NewsItem {
  id: string;
  timestampMs: number;
  headline: string;
  body: string;
}

export type StoryFaction = "none" | "arc" | "arunmor";

export interface StoryState {
  stage:
    | "dormant"
    | "dead_agent_email"
    | "active_war"
    | "arc_victory"
    | "arunmor_victory";
  faction: StoryFaction;
  act: number;
  scene: number;
  revelationVersion: number;
  faithVersion: number;
  revelationCount: number;
  faithCount: number;
  arcServerIp: string;
  arunmorServerIp: string;
  completedSpecialMissions: string[];
}

export interface ScheduledEvent {
  id: string;
  triggerAtMs: number;
  kind:
    | "passive_trace_check"
    | "bank_audit"
    | "mission_refresh"
    | "seize_gateway"
    | "seize_warning"
    | "fine_due"
    | "monthly_billing"
    | "revelation_spread";
  payload: Record<string, string | number>;
}

export interface PlayerState {
  handle: string;
  credits: number;
  bankIp: string;
  bankAccountNumber: string;
  uplinkScore: number;
  neuromancerScore: number;
  disavowed: boolean;
  disavowedReason?: string;
  recordedVoiceAdmin?: string;
  gateway: PlayerGateway;
  savedBounceRoute: string[];
  portfolio: StockHolding[];
}

export interface WorldState {
  schemaVersion: 3;
  seed: number;
  rngState: number;
  timeMs: number;
  timeScale: 0 | 1 | 2 | 4 | 60;
  player: PlayerState;
  companies: Record<string, CompanyInfo>;
  servers: Record<string, ServerNode>;
  citizens: Record<string, CitizenRecord>;
  connection: ConnectionState;
  tasks: RunningTask[];
  missions: Mission[];
  emails: EmailMessage[];
  news: NewsItem[];
  story: StoryState;
  scheduledEvents: ScheduledEvent[];
  idCounter: number;
}

export type GameEvent =
  | { type: "connection.opened"; targetIp: string; hops: number }
  | { type: "connection.closed"; targetIp: string }
  | { type: "auth.succeeded"; targetIp: string; level: AccessLevel; username: string }
  | { type: "trace.started"; targetIp: string; totalSeconds: number }
  | { type: "trace.hop"; hopIp: string; hopsRemaining: number }
  | { type: "trace.completed"; targetIp: string }
  | { type: "lan.moved"; nodeId: string }
  | { type: "lan.sysadmin_alert"; nodeId: string }
  | { type: "lan.caught"; serverIp: string }
  | { type: "task.started"; taskId: string; kind: TaskKind }
  | { type: "task.completed"; taskId: string; kind: TaskKind; summary: string }
  | { type: "mission.accepted"; missionId: string }
  | { type: "mission.completed"; missionId: string; payment: number }
  | { type: "story.updated"; stage: StoryState["stage"]; headline: string }
  | { type: "news.published"; headline: string }
  | { type: "email.received"; emailId: string; subject: string }
  | { type: "gateway.proximity"; count: number; reason: string }
  | { type: "gateway.nuked"; newGatewayId: number }
  | { type: "player.disavowed"; reason: string }
  | { type: "notice"; level: "info" | "warn" | "error"; message: string };
