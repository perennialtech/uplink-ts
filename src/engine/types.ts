export type ServerKind =
  | "public_access"
  | "internal_services"
  | "central_mainframe"
  | "bank"
  | "database_criminal"
  | "database_academic"
  | "database_social"
  | "internic"
  | "uplink_internal"
  | "uplink_test"
  | "lan";

export type AccessLevel = "none" | "user" | "admin";

export type SecurityKind = "monitor" | "proxy" | "firewall";

export interface SecuritySystem {
  kind: SecurityKind;
  level: number; // 1..5
  enabled: boolean;
  bypassed: boolean;
}

export interface VirtualFile {
  id: string;
  name: string;
  sizeGq: number; // Gigaquads
  encryptedLevel: number; // 0 = plaintext, 1..7 = encrypted
  dataTag?: "revelation" | "faith" | "mission";
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
    | "deleted";
  fromIp: string;
  toIp?: string;
  detail: string;
  /** True if erased by Log Deleter v1-v3 (recoverable by Log Undeleter) */
  suspiciousDeletion: boolean;
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
}

export type LanNodeKind =
  | "router"
  | "hub"
  | "terminal"
  | "lock"
  | "auth_server"
  | "modem"
  | "main_server";

export interface LanNode {
  id: string;
  label: string;
  kind: LanNodeKind;
  x: number;
  y: number;
  visible: boolean;
  probed: boolean;
  unlocked: boolean;
  spoofed: boolean;
  /** Optional ID of auth_server or terminal that unlocks/spoofs this node */
  requiresNodeId?: string;
  connectedTo: string[];
}

export interface LanSession {
  serverIp: string;
  currentNodeId: string;
  sysadminNodeId: string | null;
  sysadminAlerted: boolean;
  sysadminStepTimerSec: number;
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
  /** Base ticks per password character */
  hackDifficulty: number;
  /** Whether the player knows this IP in their link list */
  discovered: boolean;
  /** Highest known access level for bounce-delay bonuses */
  playerAccess: AccessLevel;
  security: SecuritySystem[];
  accounts: UserAccount[];
  files: VirtualFile[];
  logs: LogEntry[];
  bankAccounts: BankAccount[];
  lanNodes?: LanNode[];
  /** Infected by ARC's Revelation virus */
  revelationInfected?: boolean;
  /** Protected/purged by Arunmor's Faith */
  faithProtected?: boolean;
}

export type SoftwareCategory = "cracker" | "bypasser" | "file_util" | "security" | "lan" | "virus";

export type SoftwareId =
  | "password_breaker"
  | "dictionary_hacker"
  | "trace_tracker"
  | "log_deleter"
  | "log_undeleter"
  | "log_modifier"
  | "file_copier"
  | "file_deleter"
  | "decrypter"
  | "proxy_bypass"
  | "proxy_disable"
  | "firewall_bypass"
  | "firewall_disable"
  | "monitor_bypass"
  | "lan_scan"
  | "lan_probe"
  | "lan_spoof"
  | "lan_force"
  | "revelation"
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
  description: string;
}

export interface CpuSpec {
  id: string;
  name: string;
  ghz: number;
  cost: number;
}

export interface PlayerGateway {
  specId: string;
  locationCity: string;
  ip: string;
  x: number;
  y: number;
  cpusGhz: number[];
  memoryTotalGq: number;
  bandwidthGbps: number;
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
}

export type TaskKind =
  | "password_breaker"
  | "dictionary_hacker"
  | "trace_tracker"
  | "file_copier"
  | "file_deleter"
  | "decrypter"
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
  | "change_academic"
  | "change_criminal"
  | "change_social"
  | "bank_heist"
  | "lan_infiltration";

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
  accepted: boolean;
  completed: boolean;
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
  stage: "dormant" | "dead_agent_email" | "active_war" | "arc_victory" | "arunmor_victory";
  faction: StoryFaction;
  revelationCount: number;
  faithCount: number;
  arcServerIp: string;
  arunmorServerIp: string;
}

export interface ScheduledEvent {
  id: string;
  triggerAtMs: number;
  kind: "passive_trace_check" | "bank_audit" | "mission_refresh";
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
  gateway: PlayerGateway;
  savedBounceRoute: string[];
}

export interface WorldState {
  schemaVersion: 2;
  seed: number;
  rngState: number;
  timeMs: number;
  timeScale: 0 | 1 | 2 | 4 | 60;
  player: PlayerState;
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
  | { type: "player.disavowed"; reason: string }
  | { type: "notice"; level: "info" | "warn" | "error"; message: string };
