import {
  CPU_CATALOG,
  DICTIONARY_WORDS,
  GATEWAY_CATALOG,
  SECURITY_LEVEL_MODIFIER,
  SOFTWARE_CATALOG,
  TASK_TICKS,
  TRACE_BOUNCE_MODIFIER,
} from "./catalog";
import { EventBus } from "./events";
import {
  alertLanSysadmin,
  canMoveToLanNode,
  createLanSession,
  isOnLanMainServer,
  nextStepToward,
} from "./lan";
import { SeededRng } from "./rng";
import { checkStoryTriggers } from "./story";
import type {
  AccessLevel,
  LogEntry,
  RunningTask,
  ServerNode,
  SoftwareId,
  StoryFaction,
  TaskKind,
  WorldState,
} from "./types";
import { createInitialWorld } from "./worldGen";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export class UplinkEngine {
  private state: WorldState;
  private rng: SeededRng;
  public readonly events = new EventBus();

  constructor(initialState?: WorldState) {
    this.state = initialState ?? createInitialWorld("Agent");
    this.rng = new SeededRng(this.state.rngState);
  }

  getState(): Readonly<WorldState> {
    return this.state;
  }

  loadState(nextState: WorldState): void {
    this.state = nextState;
    this.rng = new SeededRng(nextState.rngState);
  }

  private nextId(prefix: string): string {
    this.state.idCounter += 1;
    return `${prefix}_${this.state.idCounter}`;
  }

  // ---------------------------------------------------------------------------
  // Gateway & Memory Helpers
  // ---------------------------------------------------------------------------

  getTotalCpuGhz(): number {
    return this.state.player.gateway.cpusGhz.reduce((sum, ghz) => sum + ghz, 0);
  }

  getUsedMemoryGq(): number {
    const sw = this.state.player.gateway.software.reduce((s, item) => s + item.sizeGq, 0);
    const files = this.state.player.gateway.files.reduce((s, f) => s + f.sizeGq, 0);
    return sw + files;
  }

  getHighestSoftwareVersion(id: SoftwareId): number {
    let best = 0;
    for (const sw of this.state.player.gateway.software) {
      if (sw.id === id && sw.version > best) best = sw.version;
    }
    return best;
  }

  setTimeScale(scale: WorldState["timeScale"]): void {
    this.state.timeScale = scale;
  }

  // ---------------------------------------------------------------------------
  // Connection & Bounce Routing
  // ---------------------------------------------------------------------------

  addBounceNode(ip: string): boolean {
    if (this.state.connection.connected) return false;
    if (!this.state.servers[ip]) return false;
    if (this.state.connection.route.includes(ip)) return false;
    this.state.connection.route.push(ip);
    return true;
  }

  removeLastBounceNode(): void {
    if (this.state.connection.connected) return;
    if (this.state.connection.route.length > 1) {
      this.state.connection.route.pop();
    }
  }

  clearRoute(): void {
    if (this.state.connection.connected) return;
    this.state.connection.route = [this.state.player.gateway.ip];
  }

  saveBounceRoute(): void {
    this.state.player.savedBounceRoute = this.state.connection.route.slice(1);
  }

  loadBounceRoute(): void {
    if (this.state.connection.connected) return;
    this.state.connection.route = [
      this.state.player.gateway.ip,
      ...this.state.player.savedBounceRoute.filter((ip) => Boolean(this.state.servers[ip])),
    ];
  }

  getTargetServer(): ServerNode | undefined {
    const { route, connected } = this.state.connection;
    if (!connected || route.length < 2) return undefined;
    return this.state.servers[route[route.length - 1]!];
  }

  computeBounceModifier(node: ServerNode): number {
    if (node.kind === "bank" && node.playerAccess === "admin") {
      return TRACE_BOUNCE_MODIFIER.bankAdmin;
    }
    if (node.kind === "central_mainframe" && node.playerAccess !== "none") {
      return TRACE_BOUNCE_MODIFIER.centralMainframe;
    }
    if (node.playerAccess === "admin") return TRACE_BOUNCE_MODIFIER.adminAccess;
    if (node.playerAccess === "user") return TRACE_BOUNCE_MODIFIER.hasAccount;
    return TRACE_BOUNCE_MODIFIER.noAccount;
  }

  computeHopTraceSeconds(target: ServerNode, hopIp: string): number {
    if (target.traceSpeedSec <= 0) return Number.POSITIVE_INFINITY;
    const hopServer = this.state.servers[hopIp];
    const mod = hopServer ? this.computeBounceModifier(hopServer) : 1.0;
    return Math.max(0.5, target.traceSpeedSec * mod);
  }

  computeTotalTraceSeconds(route: readonly string[]): number {
    if (route.length < 2) return Number.POSITIVE_INFINITY;
    const target = this.state.servers[route[route.length - 1]!];
    if (!target || target.traceSpeedSec <= 0) return Number.POSITIVE_INFINITY;
    let total = 0;
    for (let i = route.length - 1; i >= 1; i--) {
      total += this.computeHopTraceSeconds(target, route[i - 1]!);
    }
    return total;
  }

  connect(): boolean {
    if (this.state.player.disavowed) return false;
    const { route, connected } = this.state.connection;
    if (connected || route.length < 2) return false;

    const targetIp = route[route.length - 1]!;
    const target = this.state.servers[targetIp];
    if (!target) return false;

    this.state.connection.connected = true;
    this.state.connection.authenticatedAs =
      target.kind === "public_access" ? "user" : "none";
    delete this.state.connection.authenticatedUser;
    delete this.state.connection.authenticatedBankAccount;
    this.state.connection.traceActive = false;
    this.state.connection.traceHopsCompleted = 0;
    this.state.connection.secondsUntilNextHop = 0;
    this.state.connection.totalTraceSecondsRemaining = 0;
    this.state.connection.totalTraceSecondsInitial = 0;
    this.state.connection.lanSession = createLanSession(target);

    for (let i = 1; i < route.length; i++) {
      const fromIp = route[i - 1]!;
      const curIp = route[i]!;
      const nextIp = route[i + 1];
      const srv = this.state.servers[curIp];
      if (!srv) continue;

      if (nextIp) {
        this.appendLog(srv, {
          type: "bounce",
          fromIp,
          toIp: nextIp,
          detail: `Connection from ${fromIp} routed to ${nextIp}`,
        });
      } else {
        this.appendLog(srv, {
          type: "connection",
          fromIp,
          detail: `Connection established from ${fromIp}`,
        });
      }
    }

    if (target.security.some((s) => !s.enabled)) {
      this.beginTrace();
    }

    this.events.emit({ type: "connection.opened", targetIp, hops: route.length - 1 });
    return true;
  }

  disconnect(): void {
    const target = this.getTargetServer();
    if (!target) return;

    this.state.tasks = this.state.tasks.filter(
      (t) =>
        t.kind === "trace_tracker" ||
        t.kind === "decrypter" ||
        t.targetIp !== target.ip
    );

    for (const sec of target.security) {
      sec.bypassed = false;
    }

    if (this.state.connection.traceActive && target.traceSpeedSec > 0) {
      this.schedulePassiveTrace(target.ip);
    }

    const targetIp = target.ip;
    this.state.connection.connected = false;
    this.state.connection.authenticatedAs = "none";
    delete this.state.connection.authenticatedUser;
    delete this.state.connection.authenticatedBankAccount;
    this.state.connection.traceActive = false;
    this.state.connection.traceHopsCompleted = 0;
    this.state.connection.secondsUntilNextHop = 0;
    this.state.connection.totalTraceSecondsRemaining = 0;
    this.state.connection.lanSession = null;

    this.events.emit({ type: "connection.closed", targetIp });
  }

  beginTrace(): void {
    const conn = this.state.connection;
    if (!conn.connected || conn.traceActive) return;
    const target = this.getTargetServer();
    if (!target || target.traceSpeedSec <= 0) return;

    const monitor = target.security.find((s) => s.kind === "monitor");
    if (monitor && monitor.bypassed) return;

    const total = this.computeTotalTraceSeconds(conn.route);
    if (!Number.isFinite(total)) return;

    const firstHopIp = conn.route[conn.route.length - 2]!;
    conn.traceActive = true;
    conn.traceHopsCompleted = 0;
    conn.secondsUntilNextHop = this.computeHopTraceSeconds(target, firstHopIp);
    conn.totalTraceSecondsInitial = total;
    conn.totalTraceSecondsRemaining = total;

    this.events.emit({ type: "trace.started", targetIp: target.ip, totalSeconds: total });
  }

  // ---------------------------------------------------------------------------
  // LAN Traversal
  // ---------------------------------------------------------------------------

  moveLanNode(targetNodeId: string): boolean {
    const target = this.getTargetServer();
    const session = this.state.connection.lanSession;
    if (!target || !target.lanNodes || !session) return false;

    const check = canMoveToLanNode(target.lanNodes, session, targetNodeId);
    if (!check.ok) {
      this.events.emit({ type: "notice", level: "warn", message: check.reason ?? "Cannot move there." });
      return false;
    }

    session.currentNodeId = targetNodeId;
    const node = target.lanNodes.find((n) => n.id === targetNodeId);
    if (node) {
      for (const adjId of node.connectedTo) {
        const adj = target.lanNodes.find((n) => n.id === adjId);
        if (adj) adj.visible = true;
      }
      if (node.kind === "main_server") {
        alertLanSysadmin(target.lanNodes, session);
        this.events.emit({ type: "lan.sysadmin_alert", nodeId: node.id });
      }
    }
    this.events.emit({ type: "lan.moved", nodeId: targetNodeId });
    return true;
  }

  private isLanMainReady(target: ServerNode): boolean {
    if (!target.lanNodes) return true;
    return isOnLanMainServer(target.lanNodes, this.state.connection.lanSession);
  }

  // ---------------------------------------------------------------------------
  // Authentication, Banks & Government Databases
  // ---------------------------------------------------------------------------

  login(username: string, password: string): boolean {
    const target = this.getTargetServer();
    if (!target) return false;
    if (!this.isLanMainReady(target)) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Reach the LAN Main Server before logging into admin.",
      });
      return false;
    }
    const account = target.accounts.find(
      (a) => a.username.toLowerCase() === username.toLowerCase() && a.password === password
    );
    if (!account) return false;

    const level: AccessLevel = account.securityLevel === 1 ? "admin" : "user";
    this.state.connection.authenticatedAs = level;
    this.state.connection.authenticatedUser = account.username;

    if (level === "admin" || target.playerAccess === "none") {
      target.playerAccess = level;
    }

    const apparentIp = this.state.connection.route[this.state.connection.route.length - 2]!;
    this.appendLog(target, {
      type: "login",
      fromIp: apparentIp,
      detail: `Password authentication accepted for ${account.username}`,
    });

    this.events.emit({
      type: "auth.succeeded",
      targetIp: target.ip,
      level,
      username: account.username,
    });
    return true;
  }

  loginBankAccount(accountNumber: string, password: string): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "bank") return false;
    const acct = target.bankAccounts.find(
      (a) => a.accountNumber === accountNumber && a.password === password
    );
    if (!acct) return false;

    this.state.connection.authenticatedBankAccount = acct.accountNumber;
    this.state.connection.authenticatedAs = "user";
    if (target.playerAccess === "none") target.playerAccess = "user";

    this.events.emit({
      type: "auth.succeeded",
      targetIp: target.ip,
      level: "user",
      username: `Acct #${acct.accountNumber}`,
    });
    return true;
  }

  transferBankFunds(destIp: string, destAccountNumber: string, amount: number): boolean {
    const target = this.getTargetServer();
    const srcNum = this.state.connection.authenticatedBankAccount;
    if (!target || target.kind !== "bank" || !srcNum) return false;
    if (amount <= 0 || !Number.isFinite(amount)) return false;

    const srcAcct = target.bankAccounts.find((a) => a.accountNumber === srcNum);
    const destBank = this.state.servers[destIp];
    const destAcct = destBank?.bankAccounts.find((a) => a.accountNumber === destAccountNumber);
    if (!srcAcct || !destBank || !destAcct) return false;
    if (srcAcct.balance < amount) return false;

    srcAcct.balance -= amount;
    destAcct.balance += amount;
    if (destAccountNumber === this.state.player.bankAccountNumber) {
      this.state.player.credits += amount;
    }

    const outStmtId = this.nextId("stmt");
    const inStmtId = this.nextId("stmt");
    srcAcct.statements.unshift({
      id: outStmtId,
      timestampMs: this.state.timeMs,
      amount: -amount,
      counterpartyIp: destIp,
      counterpartyAccount: destAccountNumber,
      note: `Transfer to ${destIp} #${destAccountNumber}`,
    });
    destAcct.statements.unshift({
      id: inStmtId,
      timestampMs: this.state.timeMs,
      amount,
      counterpartyIp: target.ip,
      counterpartyAccount: srcNum,
      note: `Transfer from ${target.ip} #${srcNum}`,
    });

    this.appendLog(target, {
      type: "bank_transfer",
      fromIp: this.state.connection.route[this.state.connection.route.length - 2]!,
      detail: `Transfer ${amount}c from #${srcNum} to #${destAccountNumber}`,
    });

    // If stealing from another person's account, schedule a bank audit!
    if (srcNum !== this.state.player.bankAccountNumber) {
      this.beginTrace();
      this.state.scheduledEvents.push({
        id: this.nextId("evt"),
        triggerAtMs: this.state.timeMs + 2 * 3600 * 1000,
        kind: "bank_audit",
        payload: {
          bankIp: target.ip,
          victimAccount: srcNum,
          outStmtId,
          destBankIp: destIp,
          destAccount: destAccountNumber,
          inStmtId,
        },
      });
    }

    this.events.emit({
      type: "notice",
      level: "info",
      message: `Transferred ${amount.toLocaleString()}c to #${destAccountNumber}. Delete BOTH statements before audit!`,
    });
    return true;
  }

  deleteBankStatement(accountNumber: string, statementId: string): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "bank") return false;
    if (
      this.state.connection.authenticatedBankAccount !== accountNumber &&
      this.state.connection.authenticatedAs !== "admin"
    ) {
      return false;
    }
    const acct = target.bankAccounts.find((a) => a.accountNumber === accountNumber);
    if (!acct) return false;
    const idx = acct.statements.findIndex((s) => s.id === statementId);
    if (idx === -1) return false;
    acct.statements.splice(idx, 1);
    return true;
  }

  runBankAudit(payload: Record<string, string | number>): boolean {
    const bankIp = String(payload.bankIp ?? "");
    const victimAccount = String(payload.victimAccount ?? "");
    const outStmtId = String(payload.outStmtId ?? "");
    const destBankIp = String(payload.destBankIp ?? "");
    const destAccount = String(payload.destAccount ?? "");
    const inStmtId = String(payload.inStmtId ?? "");

    const victimBank = this.state.servers[bankIp];
    const destBank = this.state.servers[destBankIp];
    const vAcct = victimBank?.bankAccounts.find((a) => a.accountNumber === victimAccount);
    const dAcct = destBank?.bankAccounts.find((a) => a.accountNumber === destAccount);

    const outStillThere = Boolean(vAcct?.statements.some((s) => s.id === outStmtId));
    const inStillThere = Boolean(dAcct?.statements.some((s) => s.id === inStmtId));

    // Player is caught if EITHER transfer statement remains on record!
    if ((outStillThere || inStillThere) && destAccount === this.state.player.bankAccountNumber) {
      this.disavowPlayer(
        `Bank audit at ${victimBank?.name ?? bankIp} matched an undeleted transfer statement to your account #${destAccount}.`
      );
      return true;
    }
    return false;
  }

  updateAcademicRecord(citizenId: string, newGpa: string): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "database_academic" || this.state.connection.authenticatedAs === "none") {
      return false;
    }
    if (this.isProxyBlocking(target)) {
      this.events.emit({ type: "notice", level: "warn", message: "Proxy blocked database edit." });
      return false;
    }
    const cit = this.state.citizens[citizenId];
    if (!cit) return false;
    cit.gpa = newGpa;
    this.beginTrace();
    this.events.emit({ type: "notice", level: "info", message: `Updated ${cit.fullName}'s GPA to ${newGpa}.` });
    return true;
  }

  updateCriminalRecord(citizenId: string, action: "clear" | "add_crime" | "warrant", detail?: string): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "database_criminal" || this.state.connection.authenticatedAs === "none") {
      return false;
    }
    if (this.isProxyBlocking(target)) {
      this.events.emit({ type: "notice", level: "warn", message: "Proxy blocked database edit." });
      return false;
    }
    const cit = this.state.citizens[citizenId];
    if (!cit) return false;
    if (action === "clear") {
      cit.criminalHistory = [];
      cit.arrestWarrant = false;
    } else if (action === "add_crime") {
      cit.criminalHistory.push(detail ?? "High-security cyber intrusion");
    } else if (action === "warrant") {
      cit.arrestWarrant = true;
    }
    this.beginTrace();
    this.events.emit({ type: "notice", level: "info", message: `Modified criminal record for ${cit.fullName}.` });
    return true;
  }

  updateSocialRecord(citizenId: string, employment: string, deceased?: boolean): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "database_social" || this.state.connection.authenticatedAs === "none") {
      return false;
    }
    if (this.isProxyBlocking(target)) {
      this.events.emit({ type: "notice", level: "warn", message: "Proxy blocked database edit." });
      return false;
    }
    const cit = this.state.citizens[citizenId];
    if (!cit) return false;
    cit.employment = employment;
    if (deceased !== undefined) cit.deceased = deceased;
    this.beginTrace();
    this.events.emit({ type: "notice", level: "info", message: `Updated social record for ${cit.fullName}.` });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Storyline (ARC vs. Arunmor — Revelation & Faith)
  // ---------------------------------------------------------------------------

  joinStoryFaction(faction: Exclude<StoryFaction, "none">): boolean {
    if (this.state.story.stage !== "dead_agent_email") return false;
    this.state.story.faction = faction;
    this.state.story.stage = "active_war";

    const swId: SoftwareId = faction === "arc" ? "revelation" : "faith";
    if (this.getHighestSoftwareVersion(swId) === 0) {
      this.state.player.gateway.software.push({ id: swId, version: 1, sizeGq: 2 });
    }

    const headline =
      faction === "arc"
        ? "ARC Activates Contract Agent for Project Revelation"
        : "Arunmor Deploys Counter-Intrusion Unit With Faith v1.0";
    this.state.news.unshift({
      id: this.nextId("news"),
      timestampMs: this.state.timeMs,
      headline,
      body:
        faction === "arc"
          ? "Connect to corporate servers with admin access and deploy Revelation to infect 5 systems."
          : "Connect to corporate servers with admin access and deploy Faith to harden/purge 5 systems.",
    });
    this.events.emit({ type: "story.updated", stage: this.state.story.stage, headline });
    return true;
  }

  deployStoryPayload(payload: "revelation" | "faith"): boolean {
    const target = this.getTargetServer();
    if (!target || this.state.connection.authenticatedAs !== "admin") return false;
    if (this.getHighestSoftwareVersion(payload) === 0) return false;

    if (payload === "revelation") {
      if (target.revelationInfected) return false;
      target.revelationInfected = true;
      target.faithProtected = false;
      this.state.story.revelationCount += 1;
      this.state.player.neuromancerScore -= 40;
      this.beginTrace();
    } else {
      if (target.faithProtected) return false;
      target.faithProtected = true;
      if (target.revelationInfected) {
        target.revelationInfected = false;
        this.state.story.revelationCount = Math.max(0, this.state.story.revelationCount - 1);
      }
      this.state.story.faithCount += 1;
      this.state.player.neuromancerScore += 40;
    }

    const trig = checkStoryTriggers(this.state, (p) => this.nextId(p));
    if (trig.stageChanged && trig.headline) {
      this.events.emit({ type: "story.updated", stage: this.state.story.stage, headline: trig.headline });
    }
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Deployed ${payload.toUpperCase()} on ${target.name}.`,
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isProxyBlocking(server: ServerNode): boolean {
    const proxy = server.security.find((s) => s.kind === "proxy");
    return Boolean(proxy && proxy.enabled && !proxy.bypassed);
  }

  private appendLog(
    server: ServerNode,
    entry: Omit<LogEntry, "id" | "timestampMs" | "suspiciousDeletion">
  ): void {
    server.logs.unshift({
      ...entry,
      id: this.nextId("log"),
      timestampMs: this.state.timeMs,
      suspiciousDeletion: false,
    });
    if (server.logs.length > 50) {
      server.logs.length = 50;
    }
  }

  // ---------------------------------------------------------------------------
  // Task Manager (Cooperative CPU Scheduler)
  // ---------------------------------------------------------------------------

  startTask(kind: TaskKind, targetRef?: string, extraRef?: string): RunningTask | null {
    if (this.state.player.disavowed) return null;

    const swId = kind as SoftwareId;
    const version = this.getHighestSoftwareVersion(swId);
    if (version <= 0) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `Software not installed: ${kind.replace(/_/g, " ")}`,
      });
      return null;
    }

    const target = this.getTargetServer();
    if (kind !== "trace_tracker" && kind !== "decrypter" && !target) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Connect to a target server first.",
      });
      return null;
    }

    const persistent =
      kind === "trace_tracker" ||
      kind === "proxy_bypass" ||
      kind === "firewall_bypass" ||
      kind === "monitor_bypass";

    if (persistent && this.state.tasks.some((t) => t.kind === kind)) {
      return this.state.tasks.find((t) => t.kind === kind) ?? null;
    }

    const task: RunningTask = {
      id: this.nextId("task"),
      kind,
      version,
      targetIp: target ? target.ip : this.state.player.gateway.ip,
      ...(targetRef !== undefined ? { targetRef } : {}),
      cpuWeight: persistent ? 1 : 5,
      allocatedGhz: 0,
      progress: 0,
      statusText: "Initializing...",
      completed: false,
      persistent,
    };

    if (kind === "decrypter") {
      const localFile = this.state.player.gateway.files.find((f) => f.id === targetRef);
      if (!localFile || localFile.encryptedLevel <= 0) return null;
      if (localFile.encryptedLevel > version) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `Decrypter v${version}.0 cannot decrypt Level ${localFile.encryptedLevel} file.`,
        });
        return null;
      }
      task.meta = { fileSizeGq: localFile.sizeGq, fileName: localFile.name, ticksDone: 0 };
      task.statusText = `Decrypting ${localFile.name}...`;
    } else if (target) {
      if (kind === "password_breaker" || kind === "dictionary_hacker") {
        // Support cracking either admin account OR a bank account number
        const bankAcct =
          target.kind === "bank" && targetRef
            ? target.bankAccounts.find((a) => a.accountNumber === targetRef)
            : undefined;
        const acct = bankAcct
          ? { username: bankAcct.accountNumber, password: bankAcct.password, securityLevel: 2 }
          : target.accounts.find((a) => a.username === (targetRef ?? "admin")) ?? target.accounts[0];
        if (!acct) return null;
        if (!bankAcct && !this.isLanMainReady(target)) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: "Traverse the LAN to Main Server before cracking admin.",
          });
          return null;
        }
        const secMod = SECURITY_LEVEL_MODIFIER[acct.securityLevel] ?? 1.0;
        const totalTicks =
          kind === "dictionary_hacker"
            ? TASK_TICKS.dictionaryBase
            : Math.max(15, target.hackDifficulty * secMod * acct.password.length);
        task.meta = {
          username: acct.username,
          password: acct.password,
          isBank: Boolean(bankAcct),
          totalTicks,
          ticksDone: 0,
        };
        task.statusText = `Cracking ${acct.username}: ${"*".repeat(acct.password.length)}`;
        this.beginTrace();
      } else if (kind === "proxy_disable" || kind === "firewall_disable") {
        this.beginTrace();
        task.statusText = kind === "proxy_disable" ? "Disabling Proxy..." : "Disabling Firewall...";
      } else if (kind === "proxy_bypass" || kind === "firewall_bypass" || kind === "monitor_bypass") {
        const secKind = kind.replace("_bypass", "") as "proxy" | "firewall" | "monitor";
        const sec = target.security.find((s) => s.kind === secKind);
        if (sec && sec.level <= version) {
          sec.bypassed = true;
          task.progress = 1;
          task.statusText = `${secKind.toUpperCase()} Lv.${sec.level} bypassed`;
        } else {
          task.statusText = sec ? `Requires v${sec.level}+` : `No ${secKind} detected`;
        }
      } else if (kind === "file_copier" || kind === "file_deleter") {
        if (this.state.connection.authenticatedAs === "none") {
          this.events.emit({ type: "notice", level: "warn", message: "Authenticate first." });
          return null;
        }
        if (kind === "file_deleter" && this.isProxyBlocking(target)) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: "Remote Proxy blocked file deletion. Bypass or disable Proxy first.",
          });
          return null;
        }
        const file = target.files.find((f) => f.id === targetRef);
        if (!file) return null;
        if (
          kind === "file_copier" &&
          this.getUsedMemoryGq() + file.sizeGq > this.state.player.gateway.memoryTotalGq
        ) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: `Insufficient gateway memory (need ${file.sizeGq} Gq).`,
          });
          return null;
        }
        task.meta = { fileSizeGq: file.sizeGq, fileName: file.name, ticksDone: 0 };
        task.statusText =
          kind === "file_copier" ? `Copying ${file.name}...` : `Deleting ${file.name}...`;
      } else if (kind === "log_deleter" || kind === "log_undeleter" || kind === "log_modifier") {
        if (this.state.connection.authenticatedAs !== "admin") {
          this.events.emit({ type: "notice", level: "warn", message: "Admin access required." });
          return null;
        }
        const log = target.logs.find((l) => l.id === targetRef);
        if (!log) return null;
        task.meta = { ticksDone: 0, newFromIp: extraRef ?? "198.51.100.77" };
        task.statusText =
          kind === "log_deleter"
            ? `Erasing log (v${version})...`
            : kind === "log_undeleter"
              ? "Recovering deleted log..."
              : "Spoofing log IP...";
      } else if (kind === "lan_scan" || kind === "lan_probe" || kind === "lan_spoof" || kind === "lan_force") {
        if (!target.lanNodes) return null;
        task.meta = { ticksDone: 0 };
        task.statusText = `${kind.replace(/_/g, " ").toUpperCase()}...`;
      }
    } else if (kind === "trace_tracker") {
      task.statusText = "No active trace";
    }

    this.state.tasks.push(task);
    this.rebalanceCpuShares();
    this.events.emit({ type: "task.started", taskId: task.id, kind });
    return task;
  }

  stopTask(taskId: string): void {
    const idx = this.state.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    const task = this.state.tasks[idx]!;
    const target = this.state.servers[task.targetIp];
    if (target && task.kind.endsWith("_bypass")) {
      const secKind = task.kind.replace("_bypass", "");
      const sec = target.security.find((s) => s.kind === secKind);
      if (sec) sec.bypassed = false;
    }
    this.state.tasks.splice(idx, 1);
    this.rebalanceCpuShares();
  }

  setTaskWeight(taskId: string, weight: number): void {
    const task = this.state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.cpuWeight = Math.max(1, Math.min(10, Math.round(weight)));
    this.rebalanceCpuShares();
  }

  private rebalanceCpuShares(): void {
    const totalGhz = this.getTotalCpuGhz();
    const totalWeight = this.state.tasks.reduce((sum, t) => sum + t.cpuWeight, 0);
    if (totalWeight <= 0) return;
    for (const t of this.state.tasks) {
      t.allocatedGhz = (totalGhz * t.cpuWeight) / totalWeight;
    }
  }

  // ---------------------------------------------------------------------------
  // Fixed-Timestep Tick
  // ---------------------------------------------------------------------------

  tick(deltaRealSec: number): void {
    if (this.state.player.disavowed || this.state.timeScale === 0 || deltaRealSec <= 0) {
      return;
    }

    const simSec = deltaRealSec * this.state.timeScale;
    this.state.timeMs += Math.round(simSec * 1000);

    this.tickTrace(simSec);
    this.tickLanSysadmin(simSec);
    this.tickTasks(simSec);
    this.tickScheduledEvents();
    this.state.rngState = this.rng.getState();
  }

  private tickLanSysadmin(simSec: number): void {
    const session = this.state.connection.lanSession;
    const target = this.getTargetServer();
    if (!session || !target?.lanNodes || !session.sysadminAlerted || !session.sysadminNodeId) {
      return;
    }
    session.sysadminStepTimerSec -= simSec;
    if (session.sysadminStepTimerSec > 0) return;

    session.sysadminStepTimerSec = 4.0;
    const next = nextStepToward(target.lanNodes, session.sysadminNodeId, session.currentNodeId);
    if (next) {
      session.sysadminNodeId = next;
    }
    if (session.sysadminNodeId === session.currentNodeId) {
      this.events.emit({ type: "lan.caught", serverIp: target.ip });
      this.beginTrace();
      this.disconnect();
    }
  }

  private tickTrace(simSec: number): void {
    const conn = this.state.connection;
    if (!conn.connected || !conn.traceActive) return;

    const target = this.getTargetServer();
    if (!target) return;

    conn.secondsUntilNextHop -= simSec;
    conn.totalTraceSecondsRemaining = Math.max(0, conn.totalTraceSecondsRemaining - simSec);

    while (conn.secondsUntilNextHop <= 0 && conn.traceActive) {
      const overflow = -conn.secondsUntilNextHop;
      conn.traceHopsCompleted += 1;
      const hopsTotal = conn.route.length - 1;
      const hopsRemaining = Math.max(0, hopsTotal - conn.traceHopsCompleted);
      const tracedIndex = conn.route.length - 1 - conn.traceHopsCompleted;
      const hopIp = conn.route[Math.max(0, tracedIndex)]!;

      this.events.emit({ type: "trace.hop", hopIp, hopsRemaining });

      if (hopsRemaining <= 0) {
        conn.traceActive = false;
        conn.totalTraceSecondsRemaining = 0;
        this.events.emit({ type: "trace.completed", targetIp: target.ip });
        this.disavowPlayer(`Active trace completed by ${target.name} (${target.ip}).`);
        return;
      }

      const nextHopIp = conn.route[tracedIndex - 1]!;
      conn.secondsUntilNextHop = this.computeHopTraceSeconds(target, nextHopIp) - overflow;
    }
  }

  private tickTasks(simSec: number): void {
    this.rebalanceCpuShares();
    const completedIds: string[] = [];

    for (const task of this.state.tasks) {
      if (task.kind === "trace_tracker") {
        this.updateTraceTrackerStatus(task);
        continue;
      }
      if (task.persistent) continue;

      const ticks = task.allocatedGhz * simSec;

      if (task.kind === "decrypter" && task.meta) {
        const sizeGq = Number(task.meta.fileSizeGq ?? 1);
        const totalTicks = Math.max(15, sizeGq * TASK_TICKS.decryptPerGq);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);
        if (task.progress >= 1) {
          const localFile = this.state.player.gateway.files.find((f) => f.id === task.targetRef);
          if (localFile) localFile.encryptedLevel = 0;
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Decrypted ${String(task.meta.fileName)}`,
          });
          completedIds.push(task.id);
        }
        continue;
      }

      const target = this.state.servers[task.targetIp];
      if (!target) {
        completedIds.push(task.id);
        continue;
      }

      if ((task.kind === "password_breaker" || task.kind === "dictionary_hacker") && task.meta) {
        const totalTicks = Number(task.meta.totalTicks ?? 100);
        const password = String(task.meta.password ?? "");
        const username = String(task.meta.username ?? "admin");
        const isBank = Boolean(task.meta.isBank);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);

        if (task.kind === "dictionary_hacker") {
          const word = DICTIONARY_WORDS[Math.floor(this.rng.next() * DICTIONARY_WORDS.length)]!;
          task.statusText = `Testing word: ${word}`;
        } else {
          const revealed = Math.floor(task.progress * password.length);
          let display = password.slice(0, revealed);
          for (let i = revealed; i < password.length; i++) {
            display += ALPHABET[Math.floor(this.rng.next() * ALPHABET.length)]!;
          }
          task.statusText = `Cracking ${username}: ${display}`;
        }

        if (task.progress >= 1) {
          task.completed = true;
          const dictFound =
            task.kind === "password_breaker" || DICTIONARY_WORDS.includes(password);
          if (dictFound) {
            if (isBank) {
              this.loginBankAccount(username, password);
            } else {
              this.login(username, password);
            }
            this.events.emit({
              type: "task.completed",
              taskId: task.id,
              kind: task.kind,
              summary: `Password cracked for ${username} (${password})`,
            });
          } else {
            this.events.emit({
              type: "task.completed",
              taskId: task.id,
              kind: task.kind,
              summary: `Dictionary Hacker failed: password not in wordlist.`,
            });
          }
          completedIds.push(task.id);
        }
      } else if (task.kind === "file_copier" && task.meta) {
        const sizeGq = Number(task.meta.fileSizeGq ?? 1);
        const totalTicks = Math.max(10, sizeGq * TASK_TICKS.copyPerGq);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);
        if (task.progress >= 1) {
          const file = target.files.find((f) => f.id === task.targetRef);
          if (file) {
            this.state.player.gateway.files.push({ ...file, id: this.nextId("local_file") });
            const ghostIp = this.state.connection.route[this.state.connection.route.length - 2]!;
            this.appendLog(target, {
              type: "file_copied",
              fromIp: ghostIp,
              detail: `File ${file.name} accessed/copied`,
            });
            this.beginTrace();
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Copied ${String(task.meta.fileName)}`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "file_deleter" && task.meta) {
        const sizeGq = Number(task.meta.fileSizeGq ?? 1);
        const totalTicks = Math.max(5, sizeGq * TASK_TICKS.deletePerGq);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);
        if (task.progress >= 1) {
          const idx = target.files.findIndex((f) => f.id === task.targetRef);
          if (idx !== -1) {
            const [removed] = target.files.splice(idx, 1);
            const ghostIp = this.state.connection.route[this.state.connection.route.length - 2]!;
            this.appendLog(target, {
              type: "file_deleted",
              fromIp: ghostIp,
              detail: `File ${removed!.name} deleted`,
            });
            this.beginTrace();
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Deleted ${String(task.meta.fileName)}`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "log_deleter" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.logDelete);
        if (task.progress >= 1) {
          const logIdx = target.logs.findIndex((l) => l.id === task.targetRef);
          if (logIdx !== -1) {
            const log = target.logs[logIdx]!;
            if (task.version >= 4) {
              target.logs.splice(logIdx, 1);
            } else {
              log.suspiciousDeletion = true;
              log.originalDetail = log.detail;
              log.originalFromIp = log.fromIp;
              if (log.toIp) log.originalToIp = log.toIp;
              log.type = "deleted";
              log.detail = `[Log deleted — recoverable stub]`;
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: task.version >= 4 ? "Log cleanly wiped (v4)" : "Log blanked (recoverable stub)",
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "log_undeleter" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.logUndelete);
        if (task.progress >= 1) {
          const log = target.logs.find((l) => l.id === task.targetRef);
          if (log && log.suspiciousDeletion) {
            log.suspiciousDeletion = false;
            log.type = log.originalToIp ? "bounce" : "connection";
            log.detail = log.originalDetail ?? log.detail;
            log.fromIp = log.originalFromIp ?? log.fromIp;
            if (log.originalToIp) log.toIp = log.originalToIp;
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: "Recovered deleted log entry",
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "log_modifier" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.logModify);
        if (task.progress >= 1) {
          const log = target.logs.find((l) => l.id === task.targetRef);
          const spoofedIp = String(task.meta.newFromIp ?? "198.51.100.77");
          if (log) {
            log.fromIp = spoofedIp;
            log.detail = log.toIp
              ? `Connection from ${spoofedIp} routed to ${log.toIp}`
              : `Connection established from ${spoofedIp}`;
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Rewrote log source IP to ${spoofedIp}`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "proxy_disable" || task.kind === "firewall_disable") {
        const required =
          task.kind === "proxy_disable" ? TASK_TICKS.disableProxy : TASK_TICKS.disableFirewall;
        const ticksDone = Number(task.meta?.ticksDone ?? 0) + ticks;
        task.meta = { ticksDone };
        task.progress = Math.min(1, ticksDone / required);
        if (task.progress >= 1) {
          const secKind = task.kind === "proxy_disable" ? "proxy" : "firewall";
          const sec = target.security.find((s) => s.kind === secKind);
          if (sec) sec.enabled = false;
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `${secKind.toUpperCase()} disabled`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "lan_scan" && task.meta && target.lanNodes) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanScan);
        if (task.progress >= 1) {
          for (const node of target.lanNodes) {
            node.visible = true;
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Discovered ${target.lanNodes.length} LAN nodes`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "lan_probe" && task.meta && target.lanNodes) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanProbe);
        if (task.progress >= 1) {
          const node = target.lanNodes.find((n) => n.id === task.targetRef);
          if (node) {
            node.probed = true;
            for (const adjId of node.connectedTo) {
              const adj = target.lanNodes.find((n) => n.id === adjId);
              if (adj) adj.visible = true;
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Probed LAN node ${node?.label ?? ""}`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "lan_spoof" && task.meta && target.lanNodes) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanSpoof);
        if (task.progress >= 1) {
          const node = target.lanNodes.find((n) => n.id === task.targetRef);
          if (node) {
            node.spoofed = true;
            for (const locked of target.lanNodes) {
              if (locked.requiresNodeId === node.id) locked.unlocked = true;
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Spoofed ${node?.label ?? "node"} — dependent locks unlocked`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "lan_force" && task.meta && target.lanNodes) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanForce);
        if (task.progress >= 1) {
          const node = target.lanNodes.find((n) => n.id === task.targetRef);
          if (node) node.unlocked = true;
          if (this.state.connection.lanSession) {
            alertLanSysadmin(target.lanNodes, this.state.connection.lanSession);
            this.events.emit({ type: "lan.sysadmin_alert", nodeId: node?.id ?? "" });
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Forced ${node?.label ?? "lock"} open (Sysadmin alerted!)`,
          });
          completedIds.push(task.id);
        }
      }
    }

    if (completedIds.length > 0) {
      this.state.tasks = this.state.tasks.filter((t) => !completedIds.includes(t.id));
      this.rebalanceCpuShares();
    }
  }

  private updateTraceTrackerStatus(task: RunningTask): void {
    const conn = this.state.connection;
    if (!conn.connected || !conn.traceActive) {
      task.progress = 0;
      task.statusText = "No active trace";
      return;
    }
    const pct =
      conn.totalTraceSecondsInitial > 0
        ? Math.min(1, 1 - conn.totalTraceSecondsRemaining / conn.totalTraceSecondsInitial)
        : 0;
    task.progress = pct;
    const hopsLeft = Math.max(0, conn.route.length - 1 - conn.traceHopsCompleted);
    if (task.version >= 4) {
      task.statusText = `TRACE: ${Math.ceil(conn.totalTraceSecondsRemaining)}s (${hopsLeft} hops)`;
    } else if (task.version === 3) {
      task.statusText = `TRACE: ${Math.round(pct * 100)}% (${hopsLeft} hops left)`;
    } else if (task.version === 2) {
      task.statusText = `TRACE: ${Math.round(pct * 100)}%`;
    } else {
      task.statusText = "TRACE IN PROGRESS!";
    }
  }

  // ---------------------------------------------------------------------------
  // Passive Traces & Scheduled Events
  // ---------------------------------------------------------------------------

  private schedulePassiveTrace(targetIp: string): void {
    const delayMs = this.rng.int(3, 6) * 3600 * 1000;
    this.state.scheduledEvents.push({
      id: this.nextId("evt"),
      triggerAtMs: this.state.timeMs + delayMs,
      kind: "passive_trace_check",
      payload: { targetIp },
    });
  }

  private tickScheduledEvents(): void {
    const due = this.state.scheduledEvents.filter((e) => e.triggerAtMs <= this.state.timeMs);
    if (due.length === 0) return;

    this.state.scheduledEvents = this.state.scheduledEvents.filter(
      (e) => e.triggerAtMs > this.state.timeMs
    );

    for (const evt of due) {
      if (evt.kind === "passive_trace_check") {
        this.runPassiveTraceAudit(String(evt.payload.targetIp ?? ""));
      } else if (evt.kind === "bank_audit") {
        this.runBankAudit(evt.payload);
      }
    }
  }

  runPassiveTraceAudit(startIp: string): boolean {
    let currentIp = startIp;
    let downstreamIp: string | null = null;
    const visited = new Set<string>();

    for (let step = 0; step < 32; step++) {
      if (currentIp === this.state.player.gateway.ip) {
        this.disavowPlayer(
          `Passive trace audit from ${startIp} followed your bounce logs back to your gateway.`
        );
        return true;
      }
      if (visited.has(currentIp)) return false;
      visited.add(currentIp);

      const srv = this.state.servers[currentIp];
      if (!srv) return false;

      const traceLog = srv.logs.find((l) => {
        const src = l.originalFromIp ?? l.fromIp;
        if (src === currentIp) return false;
        if (downstreamIp === null) {
          return l.type === "connection" || l.suspiciousDeletion;
        }
        return (
          (l.type === "bounce" && l.toIp === downstreamIp) ||
          (l.suspiciousDeletion && (l.originalToIp ?? l.toIp) === downstreamIp)
        );
      });
      if (!traceLog) return false;

      downstreamIp = currentIp;
      currentIp = traceLog.originalFromIp ?? traceLog.fromIp;
    }

    return false;
  }

  private disavowPlayer(reason: string): void {
    if (this.state.player.disavowed) return;
    this.state.player.disavowed = true;
    this.state.player.disavowedReason = reason;
    this.state.connection.connected = false;
    this.state.connection.traceActive = false;
    this.state.connection.lanSession = null;
    this.state.tasks = [];
    this.events.emit({ type: "player.disavowed", reason });
  }

  // ---------------------------------------------------------------------------
  // Missions & Shop
  // ---------------------------------------------------------------------------

  acceptMission(missionId: string): boolean {
    const m = this.state.missions.find((x) => x.id === missionId);
    if (!m || m.accepted || m.completed) return false;
    m.accepted = true;
    const target = this.state.servers[m.targetIp];
    if (target) target.discovered = true;
    this.events.emit({ type: "mission.accepted", missionId });
    return true;
  }

  completeMission(missionId: string): boolean {
    const m = this.state.missions.find((x) => x.id === missionId);
    if (!m || !m.accepted || m.completed) return false;

    const target = this.state.servers[m.targetIp];
    if (!target) return false;

    if ((m.kind === "steal_file" || m.kind === "lan_infiltration") && m.targetFileName) {
      const idx = this.state.player.gateway.files.findIndex((f) => f.name === m.targetFileName);
      if (idx === -1) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `You haven't copied ${m.targetFileName} to your gateway yet.`,
        });
        return false;
      }
      if (this.state.player.gateway.files[idx]!.encryptedLevel > 0) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${m.targetFileName} is still encrypted! Run Decrypter on it in Gateway tab first.`,
        });
        return false;
      }
      this.state.player.gateway.files.splice(idx, 1);
    } else if (m.kind === "destroy_file" && m.targetFileName) {
      if (target.files.some((f) => f.name === m.targetFileName)) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${m.targetFileName} still exists on ${target.name}.`,
        });
        return false;
      }
    } else if (m.kind === "change_academic" && m.targetCitizenId) {
      const cit = this.state.citizens[m.targetCitizenId];
      if (!cit || cit.gpa !== m.targetValue) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${cit?.fullName ?? "Target"}'s GPA has not been updated to ${m.targetValue}.`,
        });
        return false;
      }
    } else if (m.kind === "change_criminal" && m.targetCitizenId) {
      const cit = this.state.citizens[m.targetCitizenId];
      if (!cit || cit.criminalHistory.length > 0) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${cit?.fullName ?? "Target"} still has an active criminal record.`,
        });
        return false;
      }
    } else if (m.kind === "change_social" && m.targetCitizenId) {
      const cit = this.state.citizens[m.targetCitizenId];
      if (!cit || cit.employment !== m.targetValue) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${cit?.fullName ?? "Target"}'s employer is not set to ${m.targetValue}.`,
        });
        return false;
      }
    } else if (m.kind === "bank_heist" && m.targetValue && m.targetAmount) {
      const bank = this.state.servers[m.targetIp];
      const acct = bank?.bankAccounts.find((a) => a.accountNumber === m.targetValue);
      if (!acct) return false;
      const hadTransfer = target.logs.some(
        (l) => l.type === "bank_transfer" && l.detail.includes(`#${m.targetValue}`)
      );
      if (!hadTransfer) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `No transfer from account #${m.targetValue} detected yet.`,
        });
        return false;
      }
    }

    m.completed = true;
    this.state.player.credits += m.payment;
    this.state.player.uplinkScore += m.difficulty * 3;
    this.state.player.neuromancerScore += m.kind === "destroy_file" ? 5 : m.kind === "bank_heist" ? -10 : 0;

    this.state.emails.unshift({
      id: this.nextId("email"),
      from: `contracts@${m.employer.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
      subject: `Payment Received: ${m.title}`,
      body: `Contract verified. ${m.payment.toLocaleString()} credits wired to account #${this.state.player.bankAccountNumber}.`,
      timestampMs: this.state.timeMs,
      read: false,
      missionId: m.id,
    });

    const storyRes = checkStoryTriggers(this.state, (p) => this.nextId(p));
    if (storyRes.stageChanged && storyRes.headline) {
      this.events.emit({
        type: "story.updated",
        stage: this.state.story.stage,
        headline: storyRes.headline,
      });
    }

    this.events.emit({ type: "mission.completed", missionId: m.id, payment: m.payment });
    return true;
  }

  buySoftware(id: SoftwareId, version: number): boolean {
    const def = SOFTWARE_CATALOG.find((s) => s.id === id && s.version === version);
    if (!def) return false;
    if (this.state.player.credits < def.cost) return false;
    if (this.getUsedMemoryGq() + def.sizeGq > this.state.player.gateway.memoryTotalGq) return false;

    const already = this.state.player.gateway.software.some(
      (s) => s.id === id && s.version === version
    );
    if (already) return false;

    this.state.player.credits -= def.cost;
    this.state.player.gateway.software.push({ id: def.id, version: def.version, sizeGq: def.sizeGq });
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Installed ${def.name} v${def.version}.0`,
    });
    return true;
  }

  buyCpu(cpuId: string): boolean {
    const spec = CPU_CATALOG.find((c) => c.id === cpuId);
    const gwSpec = GATEWAY_CATALOG.find((g) => g.id === this.state.player.gateway.specId);
    if (!spec || !gwSpec) return false;
    if (this.state.player.credits < spec.cost) return false;

    const cpus = this.state.player.gateway.cpusGhz;
    if (cpus.length < gwSpec.maxCpus) {
      cpus.push(spec.ghz);
    } else {
      let minIdx = 0;
      for (let i = 1; i < cpus.length; i++) {
        if (cpus[i]! < cpus[minIdx]!) minIdx = i;
      }
      if (cpus[minIdx]! >= spec.ghz) return false;
      cpus[minIdx] = spec.ghz;
    }

    this.state.player.credits -= spec.cost;
    this.rebalanceCpuShares();
    this.events.emit({ type: "notice", level: "info", message: `Installed ${spec.name}` });
    return true;
  }

  upgradeGateway(specId: string): boolean {
    const spec = GATEWAY_CATALOG.find((g) => g.id === specId);
    if (!spec) return false;
    if (this.state.player.gateway.specId === spec.id) return false;
    if (this.state.player.credits < spec.cost) return false;

    this.state.player.credits -= spec.cost;
    this.state.player.gateway.specId = spec.id;
    this.state.player.gateway.memoryTotalGq = spec.maxMemoryGq;
    this.state.player.gateway.bandwidthGbps = spec.bandwidthGbps;
    this.events.emit({ type: "notice", level: "info", message: `Upgraded to ${spec.name}` });
    return true;
  }
}
