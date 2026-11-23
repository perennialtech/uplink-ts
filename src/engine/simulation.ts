import {
  CPU_CATALOG,
  DICTIONARY_WORDS,
  FIXED_IPS,
  GATEWAY_CATALOG,
  GATEWAY_SECURITY_CATALOG,
  LOAN_TIERS,
  MEMORY_CATALOG,
  MODEM_CATALOG,
  NEUROMANCER_MISSION_DELTA,
  PLAYER_DEFAULTS,
  SECURITY_LEVEL_MODIFIER,
  SOFTWARE_CATALOG,
  TASK_TICKS,
  TRACE_BOUNCE_MODIFIER,
} from "./catalog";
import { createInitialConsole, executeConsoleCommand } from "./console";
import { EventBus } from "./events";
import {
  alertLanSysadmin,
  canMoveToLanNode,
  createLanSession,
  isOnLanMainServer,
  nextStepToward,
  toggleIsolationBridge,
  tuneLanRadio,
} from "./lan";
import { stepMonthlySharePrices } from "./records";
import { SeededRng } from "./rng";
import { checkStoryTriggers, spawnFactionStoryMissions } from "./story";
import type {
  AccessLevel,
  GatewaySecurityDevice,
  LogEntry,
  Mission,
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
  // Gateway, Hardware & Memory Helpers
  // ---------------------------------------------------------------------------

  getTotalCpuGhz(): number {
    return this.state.player.gateway.cpusGhz.reduce((sum, ghz) => sum + ghz, 0);
  }

  getEffectiveBandwidthGbps(): number {
    return Math.min(this.state.player.gateway.modemGbps, this.state.player.gateway.bandwidthGbps);
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

  hasHudUpgrade(id: "hud_map_show_trace" | "hud_connection_analysis" | "hud_lan_view" | "hud_irc_client"): boolean {
    return this.getHighestSoftwareVersion(id) > 0;
  }

  hasSecurityDevice(dev: GatewaySecurityDevice): boolean {
    return this.state.player.gateway.securityDevices.includes(dev);
  }

  setTimeScale(scale: WorldState["timeScale"]): void {
    this.state.timeScale = scale;
  }

  // ---------------------------------------------------------------------------
  // Connection & Bounce Routing
  // ---------------------------------------------------------------------------

  addBounceNode(ip: string): boolean {
    if (this.state.connection.connected) return false;
    const srv = this.state.servers[ip];
    if (!srv || srv.destroyed) return false;
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
      ...this.state.player.savedBounceRoute.filter(
        (ip) => Boolean(this.state.servers[ip]) && !this.state.servers[ip]!.destroyed
      ),
    ];
  }

  getTargetServer(): ServerNode | undefined {
    const { route, connected } = this.state.connection;
    if (!connected || route.length < 2) return undefined;
    return this.state.servers[route[route.length - 1]!];
  }

  discoverServerByIp(ip: string): ServerNode | null {
    const srv = this.state.servers[ip.trim()];
    if (!srv) return null;
    srv.discovered = true;
    this.events.emit({ type: "notice", level: "info", message: `Resolved ${srv.ip} -> ${srv.name}` });
    return srv;
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
    if (target.destroyed) {
      this.events.emit({
        type: "notice",
        level: "error",
        message: `${target.name} (${target.ip}) is offline (system destroyed).`,
      });
      return false;
    }

    this.state.connection.connected = true;
    this.state.connection.authenticatedAs =
      target.kind === "public_access" ||
      target.kind === "uplink_public" ||
      target.kind === "stock_market" ||
      target.kind === "protovision"
        ? "user"
        : "none";
    delete this.state.connection.authenticatedUser;
    delete this.state.connection.authenticatedBankAccount;
    this.state.connection.cypherPassed = !target.requiresCypher;
    this.state.connection.voicePassed = !target.requiresVoiceAuth;
    this.state.connection.traceActive = false;
    this.state.connection.traceHopsCompleted = 0;
    this.state.connection.secondsUntilNextHop = 0;
    this.state.connection.totalTraceSecondsRemaining = 0;
    this.state.connection.totalTraceSecondsInitial = 0;
    this.state.connection.lanSession = createLanSession(target);
    this.state.connection.console = createInitialConsole();

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
        t.kind === "defrag" ||
        t.kind === "ip_lookup" ||
        t.kind === "ip_probe" ||
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
    this.state.connection.cypherPassed = false;
    this.state.connection.voicePassed = false;
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
  // Remote Admin Console
  // ---------------------------------------------------------------------------

  runConsoleCommand(command: string): string[] {
    const target = this.getTargetServer();
    if (!target) return ["Not connected to a remote server."];
    if (this.state.connection.authenticatedAs !== "admin") {
      return ["Access denied: Admin privileges required for console."];
    }
    if (this.isFirewallBlocking(target)) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Remote Firewall blocked console execution. Bypass or disable Firewall first.",
      });
      return ["Blocked by remote Firewall."];
    }

    const result = executeConsoleCommand(this.state.connection.console, target, command);
    if (result.deletedSys || result.deletedUsr || result.deletedLogs) {
      this.beginTrace();
    }
    if (result.runProgram === "revelation") {
      this.deployStoryPayload("revelation");
    } else if (result.runProgram === "faith") {
      this.deployStoryPayload("faith");
    }
    if (result.shutdown) {
      if (target.destroyed) {
        this.state.news.unshift({
          id: this.nextId("news"),
          timestampMs: this.state.timeMs,
          headline: `${target.companyName} System Destroyed in Cyber Attack`,
          body: `Critical system files were erased on ${target.name} (${target.ip}) prior to forced shutdown.`,
        });
      }
      this.disconnect();
    } else if (result.disconnect) {
      this.disconnect();
    }
    return result.output;
  }

  // ---------------------------------------------------------------------------
  // LAN Traversal, Isolation Bridge & Radio
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
      node.visibility = 3;
      for (const adjId of node.connectedTo) {
        const adj = target.lanNodes.find((n) => n.id === adjId);
        if (adj) {
          adj.visible = true;
          adj.visibility = Math.max(adj.visibility, 2) as 0 | 1 | 2 | 3;
        }
      }
      if (node.kind === "main_server") {
        alertLanSysadmin(target.lanNodes, session);
        this.events.emit({ type: "lan.sysadmin_alert", nodeId: node.id });
      }
    }
    this.events.emit({ type: "lan.moved", nodeId: targetNodeId });
    return true;
  }

  flipLanIsolationBridge(bridgeNodeId: string): boolean {
    const target = this.getTargetServer();
    const session = this.state.connection.lanSession;
    if (!target?.lanNodes || !session) return false;
    if (session.currentNodeId !== bridgeNodeId) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Move to the Isolation Bridge node before toggling it.",
      });
      return false;
    }
    const res = toggleIsolationBridge(target.lanNodes, bridgeNodeId);
    this.events.emit({ type: "notice", level: res.ok ? "info" : "warn", message: res.message });
    return res.ok;
  }

  setLanRadioFrequency(freqMhz: number): boolean {
    const target = this.getTargetServer();
    const session = this.state.connection.lanSession;
    if (!target?.lanNodes || !session) return false;
    const cur = target.lanNodes.find((n) => n.id === session.currentNodeId);
    if (!cur || cur.kind !== "radio_transmitter") {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Move to the Radio Transmitter node to tune frequencies.",
      });
      return false;
    }
    const res = tuneLanRadio(target.lanNodes, session, freqMhz);
    this.events.emit({ type: "notice", level: "info", message: res.message });
    return res.ok;
  }

  private isLanMainReady(target: ServerNode): boolean {
    if (!target.lanNodes) return true;
    return isOnLanMainServer(target.lanNodes, this.state.connection.lanSession);
  }

  // ---------------------------------------------------------------------------
  // Authentication, High-Security Gates, Banks, Loans, Stocks & Gov DBs
  // ---------------------------------------------------------------------------

  login(username: string, password: string): boolean {
    const target = this.getTargetServer();
    if (!target) return false;
    if (target.kind === "protovision") {
      this.events.emit({
        type: "notice",
        level: "info",
        message: "GREETINGS PROFESSOR FALKEN. SHALL WE PLAY A GAME? (Global Thermonuclear War)",
      });
      return false;
    }
    if (!this.isLanMainReady(target)) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Reach the LAN Main Server before logging into admin.",
      });
      return false;
    }
    if (target.requiresCypher && !this.state.connection.cypherPassed) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Elliptic-Curve Cypher active. Run Decypher first.",
      });
      return false;
    }
    if (target.requiresVoiceAuth && !this.state.connection.voicePassed) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `Voice Print required (${target.voiceAdminName ?? "Admin"}). Run Voice Analyser first.`,
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
    if (srcNum === this.state.player.bankAccountNumber) {
      this.state.player.credits = Math.max(0, this.state.player.credits - amount);
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

    // Original TIME_TOCOVERBANKROBBERY = 2 minutes!
    if (srcNum !== this.state.player.bankAccountNumber) {
      this.beginTrace();
      this.state.scheduledEvents.push({
        id: this.nextId("evt"),
        triggerAtMs: this.state.timeMs + 2 * 60 * 1000,
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
      message: `Transferred ${amount.toLocaleString()}c to #${destAccountNumber}. Delete BOTH statements within 2 minutes!`,
    });
    return true;
  }

  requestBankLoan(amount: number): boolean {
    const target = this.getTargetServer();
    const acctNum = this.state.connection.authenticatedBankAccount;
    if (!target || target.kind !== "bank" || acctNum !== this.state.player.bankAccountNumber) {
      return false;
    }
    if (amount <= 0 || !Number.isFinite(amount)) return false;
    const acct = target.bankAccounts.find((a) => a.accountNumber === acctNum);
    if (!acct) return false;

    const maxLoan = acct.creditRating * 1000;
    if (acct.loan + amount > maxLoan) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `Loan denied. Max credit line is ${maxLoan.toLocaleString()}c (current loan: ${acct.loan.toLocaleString()}c).`,
      });
      return false;
    }

    acct.loan += amount;
    acct.balance += amount;
    this.state.player.credits += amount;
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Approved loan of ${amount.toLocaleString()}c (Total debt: ${acct.loan.toLocaleString()}c).`,
    });
    return true;
  }

  repayBankLoan(amount: number): boolean {
    const target = this.getTargetServer();
    const acctNum = this.state.connection.authenticatedBankAccount;
    if (!target || target.kind !== "bank" || acctNum !== this.state.player.bankAccountNumber) {
      return false;
    }
    const acct = target.bankAccounts.find((a) => a.accountNumber === acctNum);
    if (!acct || acct.loan <= 0) return false;
    const pay = Math.min(amount, acct.loan, this.state.player.credits);
    if (pay <= 0) return false;

    acct.loan -= pay;
    acct.balance = Math.max(0, acct.balance - pay);
    this.state.player.credits -= pay;
    if (acct.loan === 0) {
      acct.creditRating = Math.min(15, acct.creditRating + 1);
    }
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Repaid ${pay.toLocaleString()}c of bank loan (Remaining: ${acct.loan.toLocaleString()}c).`,
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

    if ((outStillThere || inStillThere) && destAccount === this.state.player.bankAccountNumber) {
      this.scheduleGatewaySeizure(
        `Bank audit at ${victimBank?.name ?? bankIp} matched an undeleted transfer statement to account #${destAccount}.`,
        5 * 60 * 1000
      );
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // International Stock Market System
  // ---------------------------------------------------------------------------

  buyShares(companyId: string, shares: number): boolean {
    if (shares <= 0 || !Number.isInteger(shares)) return false;
    const comp = this.state.companies[companyId];
    if (!comp) return false;
    const totalCost = comp.currentSharePrice * shares;
    if (this.state.player.credits < totalCost) {
      this.events.emit({ type: "notice", level: "warn", message: "Insufficient credits for share purchase." });
      return false;
    }

    this.state.player.credits -= totalCost;
    const existing = this.state.player.portfolio.find((p) => p.companyId === companyId);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.avgPurchasePrice = Math.round(
        (existing.avgPurchasePrice * existing.shares + totalCost) / totalShares
      );
      existing.shares = totalShares;
    } else {
      this.state.player.portfolio.push({
        companyId,
        shares,
        avgPurchasePrice: comp.currentSharePrice,
      });
    }
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Purchased ${shares} shares of ${comp.name} @ ${comp.currentSharePrice}c.`,
    });
    return true;
  }

  sellShares(companyId: string, shares: number): boolean {
    if (shares <= 0 || !Number.isInteger(shares)) return false;
    const comp = this.state.companies[companyId];
    const holding = this.state.player.portfolio.find((p) => p.companyId === companyId);
    if (!comp || !holding || holding.shares < shares) return false;

    const proceeds = comp.currentSharePrice * shares;
    this.state.player.credits += proceeds;
    holding.shares -= shares;
    if (holding.shares === 0) {
      this.state.player.portfolio = this.state.player.portfolio.filter((p) => p.companyId !== companyId);
    }
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Sold ${shares} shares of ${comp.name} for ${proceeds.toLocaleString()}c.`,
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Government Databases (Academic, Criminal, Social, Medical)
  // ---------------------------------------------------------------------------

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
      cit.criminalHistory.push(detail ?? "Unauthorised high-security cyber intrusion");
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

  updateMedicalRecord(citizenId: string, entry: string): boolean {
    const target = this.getTargetServer();
    if (!target || target.kind !== "database_medical" || this.state.connection.authenticatedAs === "none") {
      return false;
    }
    if (this.isProxyBlocking(target)) {
      this.events.emit({ type: "notice", level: "warn", message: "Proxy blocked database edit." });
      return false;
    }
    const cit = this.state.citizens[citizenId];
    if (!cit) return false;
    cit.medicalHistory.unshift(entry);
    this.beginTrace();
    this.events.emit({ type: "notice", level: "info", message: `Updated medical record for ${cit.fullName}.` });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Storyline (ARC vs. Arunmor — Revelation & Faith)
  // ---------------------------------------------------------------------------

  joinStoryFaction(faction: Exclude<StoryFaction, "none">): boolean {
    if (this.state.story.stage !== "dead_agent_email") return false;
    this.state.story.faction = faction;
    this.state.story.stage = "active_war";
    this.state.story.act = 2;
    this.state.story.scene = 1;

    const swId: SoftwareId = faction === "arc" ? "revelation" : "faith";
    if (this.getHighestSoftwareVersion(swId) === 0) {
      this.state.player.gateway.software.push({ id: swId, version: 1, sizeGq: 2 });
    }
    if (this.getHighestSoftwareVersion("revelation_tracker") === 0) {
      this.state.player.gateway.software.push({ id: "revelation_tracker", version: 1, sizeGq: 1 });
    }

    spawnFactionStoryMissions(this.state, faction, (p) => this.nextId(p));

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
          ? "Special ARC missions added to your contract board. Run Revelation on corporate hosts."
          : "Special Arunmor missions added to your contract board. Deploy Faith to purge infected hosts.",
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
      target.revelationVersion = this.state.story.revelationVersion;
      target.faithProtected = false;
      this.state.story.revelationCount += 1;
      this.state.story.revelationVersion = Math.round((this.state.story.revelationVersion + 0.4) * 10) / 10;
      this.state.player.neuromancerScore -= 40;
      this.beginTrace();
    } else {
      if (target.faithProtected) return false;
      target.faithProtected = true;
      target.faithVersion = this.state.story.faithVersion;
      if (target.revelationInfected) {
        target.revelationInfected = false;
        this.state.story.revelationCount = Math.max(0, this.state.story.revelationCount - 1);
      }
      this.state.story.faithCount += 1;
      this.state.story.faithVersion = Math.round((this.state.story.faithVersion + 0.4) * 10) / 10;
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
  // Gateway Self-Destruct (Nuke) & Consequences
  // ---------------------------------------------------------------------------

  nukeGateway(): boolean {
    if (this.state.player.disavowed) return false;
    if (!this.hasSecurityDevice("self_destruct")) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Install Gateway Self Destruct hardware first.",
      });
      return false;
    }

    if (this.state.connection.connected) {
      this.disconnect();
    }

    // Cancel all pending gateway seizure events for this gateway ID (original gatewaynuke.cpp!)
    const hadSeizure = this.state.scheduledEvents.some(
      (e) => e.kind === "seize_gateway" || e.kind === "seize_warning"
    );
    this.state.scheduledEvents = this.state.scheduledEvents.filter(
      (e) => e.kind !== "seize_gateway" && e.kind !== "seize_warning"
    );

    const gw = this.state.player.gateway;
    gw.gatewayIdNumber += 1;
    gw.nukedCount += 1;
    gw.proximityAlert = 0;
    gw.specId = "alpha";
    gw.cpusGhz = [PLAYER_DEFAULTS.startCpuGhz];
    gw.memoryTotalGq = PLAYER_DEFAULTS.startMemoryGq;
    gw.modemGbps = PLAYER_DEFAULTS.startBandwidthGbps;
    gw.bandwidthGbps = PLAYER_DEFAULTS.startBandwidthGbps;
    gw.securityDevices = [];
    gw.files = [];
    gw.software = [
      { id: "password_breaker", version: 1, sizeGq: 2 },
      { id: "trace_tracker", version: 2, sizeGq: 1 },
      { id: "file_copier", version: 1, sizeGq: 1 },
      { id: "file_deleter", version: 1, sizeGq: 1 },
      { id: "log_deleter", version: 1, sizeGq: 1 },
    ];
    this.state.player.credits = Math.max(0, this.state.player.credits - PLAYER_DEFAULTS.newGatewayCost);

    if (hadSeizure) {
      this.state.player.neuromancerScore += 150;
      this.state.player.uplinkScore = Math.max(1, this.state.player.uplinkScore - 30);
    }

    this.state.news.unshift({
      id: this.nextId("news"),
      timestampMs: this.state.timeMs,
      headline: "Federal Raid Finds Only Destroyed Hardware",
      body: "Authorities arrived at a suspected Uplink gateway location only to find the chassis vaporized by an explosive charge.",
    });

    this.events.emit({ type: "gateway.nuked", newGatewayId: gw.gatewayIdNumber });
    return true;
  }

  private handleCaughtHacking(target: ServerNode, reason: string): void {
    const gwSpec = GATEWAY_CATALOG.find((g) => g.id === this.state.player.gateway.specId);
    // VirtuaNet anonymous gateway: clean disconnect, no arrest (original consequencegenerator.cpp!)
    if (gwSpec?.anonymous) {
      if (this.state.connection.connected) this.disconnect();
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "VirtuaNet Anonymous Gateway deflected federal trace. Connection severed cleanly.",
      });
      return;
    }

    if (this.state.connection.connected) {
      this.disconnect();
    }

    if (target.traceAction === "warning_mail" || target.traceAction === "disconnect") {
      // Rotate admin password & send warning email
      const admin = target.accounts.find((a) => a.username === "admin");
      if (admin) admin.password = this.rng.pick(DICTIONARY_WORDS);
      this.state.emails.unshift({
        id: this.nextId("email"),
        from: `security@${target.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
        subject: "You were caught hacking our computer systems",
        body: `Our system administrator traced an unauthorised connection on ${target.name} (${target.ip}). We have disconnected you and rotated access codes. Future intrusions will incur legal action.`,
        timestampMs: this.state.timeMs,
        read: false,
      });
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `Traced on ${target.name}: disconnected and issued formal warning email.`,
      });
      return;
    }

    if (target.traceAction === "fine") {
      const fineAmount = 2000;
      const dueDateMs = this.state.timeMs + 7 * 24 * 3600 * 1000;
      const missionId = this.nextId("fine");
      this.state.missions.unshift({
        id: missionId,
        kind: "pay_fine",
        title: `Pay Legal Fine (${fineAmount.toLocaleString()}c) — ${target.companyName}`,
        employer: target.companyName,
        description: `${reason} Pay ${fineAmount.toLocaleString()}c within 7 days to avoid gateway seizure.`,
        difficulty: 1,
        payment: -fineAmount,
        minUplinkRating: 0,
        targetIp: target.ip,
        targetAmount: fineAmount,
        dueDateMs,
        accepted: true,
        completed: false,
      });
      this.state.scheduledEvents.push({
        id: this.nextId("evt"),
        triggerAtMs: dueDateMs,
        kind: "fine_due",
        payload: { missionId, company: target.companyName },
      });
      this.state.player.uplinkScore = Math.max(1, this.state.player.uplinkScore - 2);
      this.events.emit({
        type: "notice",
        level: "error",
        message: `Traced on ${target.name}: issued ${fineAmount.toLocaleString()}c fine (due in 7 days).`,
      });
      return;
    }

    // Legal (3 hours) or Tactical (5 minutes) -> schedule SeizeGatewayEvent with warning
    const delayMs = target.traceAction === "tactical" ? 5 * 60 * 1000 : 3 * 3600 * 1000;
    this.scheduleGatewaySeizure(reason, delayMs);
  }

  private scheduleGatewaySeizure(reason: string, delayMs: number): void {
    const triggerAtMs = this.state.timeMs + delayMs;
    const warnAtMs = Math.max(this.state.timeMs, triggerAtMs - 60 * 1000);
    const gwId = this.state.player.gateway.gatewayIdNumber;

    this.state.scheduledEvents.push({
      id: this.nextId("evt"),
      triggerAtMs: warnAtMs,
      kind: "seize_warning",
      payload: { reason, gatewayId: gwId },
    });
    this.state.scheduledEvents.push({
      id: this.nextId("evt"),
      triggerAtMs,
      kind: "seize_gateway",
      payload: { reason, gatewayId: gwId },
    });

    if (this.hasSecurityDevice("motion_sensor")) {
      this.state.player.gateway.proximityAlert += 1;
      this.events.emit({
        type: "gateway.proximity",
        count: this.state.player.gateway.proximityAlert,
        reason: "Motion Sensor: Federal agents en route to your gateway! Nuke gateway to escape.",
      });
    } else {
      this.events.emit({
        type: "notice",
        level: "error",
        message: `CRITICAL: Trace completed (${reason}). Federal seizure warrant active!`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Security Helpers
  // ---------------------------------------------------------------------------

  private isProxyBlocking(server: ServerNode): boolean {
    const proxy = server.security.find((s) => s.kind === "proxy");
    return Boolean(proxy && proxy.enabled && !proxy.bypassed);
  }

  private isFirewallBlocking(server: ServerNode): boolean {
    const fw = server.security.find((s) => s.kind === "firewall");
    return Boolean(fw && fw.enabled && !fw.bypassed);
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
    const localOnly =
      kind === "trace_tracker" ||
      kind === "decrypter" ||
      kind === "defrag" ||
      kind === "ip_lookup" ||
      kind === "ip_probe";

    if (!localOnly && !target) {
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
    } else if (kind === "defrag") {
      task.meta = { totalTicks: Math.max(20, this.state.player.gateway.memoryTotalGq * TASK_TICKS.defragPerGq), ticksDone: 0 };
      task.statusText = "Defragmenting gateway memory banks...";
    } else if (kind === "ip_lookup") {
      if (!targetRef) return null;
      task.meta = { ip: targetRef.trim(), ticksDone: 0 };
      task.statusText = `Resolving ${targetRef.trim()}...`;
    } else if (kind === "ip_probe") {
      const probeIp = targetRef ?? target?.ip;
      if (!probeIp || !this.state.servers[probeIp]) return null;
      task.targetIp = probeIp;
      task.meta = { ip: probeIp, ticksDone: 0 };
      task.statusText = `Probing ${probeIp} (v${version}.0)...`;
    } else if (target) {
      if (kind === "decypher") {
        if (!target.requiresCypher || this.state.connection.cypherPassed) return null;
        const level = target.cypherLevel ?? 1;
        task.meta = { totalTicks: Math.max(40, (TASK_TICKS.decypherBase * level) / version), ticksDone: 0 };
        task.statusText = `Breaking Elliptic-Curve Cypher (L${level})...`;
        this.beginTrace();
      } else if (kind === "voice_analyser") {
        task.meta = { adminName: target.voiceAdminName ?? "Administrator", ticksDone: 0 };
        task.statusText = `Synthesizing voiceprint (${target.voiceAdminName ?? "Admin"})...`;
      } else if (kind === "password_breaker" || kind === "dictionary_hacker") {
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
        const secKind = kind === "proxy_disable" ? "proxy" : "firewall";
        const sec = target.security.find((s) => s.kind === secKind);
        if (sec && sec.level > version) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: `${secKind.toUpperCase()} Level ${sec.level} requires Disable v${sec.level}.0+.`,
          });
          return null;
        }
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
        if (this.isFirewallBlocking(target)) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: "Remote Firewall blocked file transfer. Bypass or disable Firewall first.",
          });
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
        if (this.isProxyBlocking(target)) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: "Remote Proxy blocked log modification.",
          });
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
        task.statusText = `${kind.replace(/_/g, " ").toUpperCase()} (v${version}.0)...`;
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
        this.handleCaughtHacking(target, `Active trace completed by ${target.name} (${target.ip}).`);
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

      if (task.kind === "defrag" && task.meta) {
        const totalTicks = Number(task.meta.totalTicks ?? 72);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);
        if (task.progress >= 1) {
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: "Gateway memory banks defragmented.",
          });
          completedIds.push(task.id);
        }
        continue;
      }

      if (task.kind === "ip_lookup" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.ipLookup);
        if (task.progress >= 1) {
          const ip = String(task.meta.ip ?? "");
          const found = this.discoverServerByIp(ip);
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: found ? `IP Lookup: ${found.name} (${found.ip}) added.` : `IP Lookup: ${ip} not found.`,
          });
          completedIds.push(task.id);
        }
        continue;
      }

      if (task.kind === "ip_probe" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.ipProbe);
        if (task.progress >= 1) {
          const srv = this.state.servers[String(task.meta.ip ?? "")];
          if (srv) {
            srv.probedLevel = Math.max(srv.probedLevel, task.version);
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: srv
              ? `IP Probe v${task.version}: ${srv.security.length} security system(s) on ${srv.name}.`
              : "IP Probe failed.",
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

      if (task.kind === "decypher" && task.meta) {
        const totalTicks = Number(task.meta.totalTicks ?? 140);
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);
        if (task.progress >= 1) {
          this.state.connection.cypherPassed = true;
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: "Elliptic-Curve Cypher bypassed.",
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "voice_analyser" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.voiceAnalyse);
        if (task.progress >= 1) {
          this.state.connection.voicePassed = true;
          this.state.player.recordedVoiceAdmin = String(task.meta.adminName ?? "Admin");
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Voiceprint synthesized for ${String(task.meta.adminName)}.`,
          });
          completedIds.push(task.id);
        }
      } else if ((task.kind === "password_breaker" || task.kind === "dictionary_hacker") && task.meta) {
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
        const bwBonus = Math.max(1, this.getEffectiveBandwidthGbps());
        const totalTicks = Math.max(10, (sizeGq * TASK_TICKS.copyPerGq) / Math.sqrt(bwBonus));
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
            } else if (task.version === 3) {
              log.suspiciousDeletion = true;
              log.deletionTier = 3;
              log.originalDetail = log.detail;
              log.originalFromIp = log.fromIp;
              if (log.toIp) log.originalToIp = log.toIp;
              log.type = "overwritten";
              log.fromIp = "203.0.113.42";
              log.detail = "Connection from 203.0.113.42 routed to 198.51.100.12 [decoy]";
            } else {
              log.suspiciousDeletion = true;
              log.deletionTier = task.version === 2 ? 2 : 1;
              log.originalDetail = log.detail;
              log.originalFromIp = log.fromIp;
              if (log.toIp) log.originalToIp = log.toIp;
              log.type = "deleted";
              log.detail =
                task.version === 2
                  ? "[Blank log space — recoverable]"
                  : "[Log deleted — recoverable stub]";
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary:
              task.version >= 4
                ? "Log cleanly wiped (v4)"
                : task.version === 3
                  ? "Log overwritten with decoy (v3)"
                  : `Log blanked (v${task.version})`,
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
            delete log.deletionTier;
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
          let found = 0;
          for (const node of target.lanNodes) {
            if (node.security <= task.version) {
              node.visible = true;
              node.visibility = Math.max(node.visibility, 2) as 0 | 1 | 2 | 3;
              found += 1;
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `LAN Scan v${task.version} revealed ${found} node(s)`,
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
            node.visibility = 3;
            for (const adjId of node.connectedTo) {
              const adj = target.lanNodes.find((n) => n.id === adjId);
              if (adj) {
                adj.visible = true;
                adj.visibility = Math.max(adj.visibility, 2) as 0 | 1 | 2 | 3;
              }
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
          if (node && node.security <= task.version) {
            node.spoofed = true;
            this.state.connection.lanSession?.spoofedNodeIds.push(node.id);
            for (const locked of target.lanNodes) {
              if (locked.requiresNodeId === node.id) locked.unlocked = true;
            }
          }
          task.completed = true;
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary:
              node && node.security <= task.version
                ? `Spoofed ${node.label} — dependent locks unlocked`
                : `LAN Spoof v${task.version} insufficient for target security level`,
          });
          completedIds.push(task.id);
        }
      } else if (task.kind === "lan_force" && task.meta && target.lanNodes) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanForce);
        if (task.progress >= 1) {
          const node = target.lanNodes.find((n) => n.id === task.targetRef);
          if (node && node.security <= task.version) {
            node.unlocked = true;
          }
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
      } else if (evt.kind === "seize_warning") {
        if (Number(evt.payload.gatewayId) === this.state.player.gateway.gatewayIdNumber) {
          this.state.player.gateway.proximityAlert += 1;
          this.events.emit({
            type: "gateway.proximity",
            count: this.state.player.gateway.proximityAlert,
            reason: "IMMINENT RAID: Federal agents are at your gateway door! Nuke now to survive.",
          });
        }
      } else if (evt.kind === "seize_gateway") {
        if (Number(evt.payload.gatewayId) === this.state.player.gateway.gatewayIdNumber) {
          this.disavowPlayer(String(evt.payload.reason ?? "Gateway seized by federal agents."));
        }
      } else if (evt.kind === "fine_due") {
        const fineMission = this.state.missions.find((m) => m.id === String(evt.payload.missionId));
        if (fineMission && !fineMission.completed) {
          fineMission.failed = true;
          this.scheduleGatewaySeizure(
            `Failed to pay legal fine to ${String(evt.payload.company)}.`,
            3 * 3600 * 1000
          );
        }
      } else if (evt.kind === "mission_refresh") {
        this.generateDynamicMission();
        this.state.scheduledEvents.push({
          id: this.nextId("evt"),
          triggerAtMs: this.state.timeMs + 12 * 3600 * 1000,
          kind: "mission_refresh",
          payload: {},
        });
      } else if (evt.kind === "monthly_billing") {
        this.processMonthlyBilling();
        this.state.scheduledEvents.push({
          id: this.nextId("evt"),
          triggerAtMs: this.state.timeMs + 30 * 24 * 3600 * 1000,
          kind: "monthly_billing",
          payload: {},
        });
      }
    }
  }

  private processMonthlyBilling(): void {
    // Deduct monthly Uplink fee (300c)
    this.state.player.credits = Math.max(0, this.state.player.credits - PLAYER_DEFAULTS.monthlyFee);
    // Apply loan interest
    const bank = this.state.servers[this.state.player.bankIp];
    const acct = bank?.bankAccounts.find((a) => a.accountNumber === this.state.player.bankAccountNumber);
    if (acct && acct.loan > 0) {
      const tier = LOAN_TIERS.find((t) => acct.loan <= t.maxAmount) ?? LOAN_TIERS[LOAN_TIERS.length - 1]!;
      const interest = Math.round((acct.loan * tier.interestRate) / 12);
      acct.loan += interest;
    }
    // Step stock market monthly prices
    stepMonthlySharePrices(this.state.companies, this.rng);
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Monthly Uplink fee (${PLAYER_DEFAULTS.monthlyFee}c) billed; Stock Market prices updated.`,
    });
  }

  private generateDynamicMission(): void {
    const activeCount = this.state.missions.filter((m) => !m.completed && !m.failed).length;
    if (activeCount >= 14) return;
    const corps = Object.values(this.state.servers).filter(
      (s) => (s.kind === "internal_services" || s.kind === "central_mainframe") && !s.destroyed && s.files.length > 0
    );
    if (corps.length === 0) return;
    const target = this.rng.pick(corps);
    const file = this.rng.pick(target.files);
    const isSteal = this.rng.chance(0.5);
    const diff = this.rng.int(2, 6);
    const payment = diff * (isSteal ? 900 : 800);
    const mission: Mission = {
      id: this.nextId("mission"),
      kind: isSteal ? "steal_file" : "destroy_file",
      title: isSteal
        ? `Extract ${file.name} from ${target.companyName}`
        : `Erase ${file.name} on ${target.companyName}`,
      employer: "Anonymous Corporate Client",
      description: isSteal
        ? `Break into ${target.name} (${target.ip}) and copy ${file.name} to your gateway.`
        : `Break into ${target.name} (${target.ip}) and delete ${file.name}.`,
      difficulty: diff,
      payment,
      minUplinkRating: Math.max(0, diff - 2),
      targetIp: target.ip,
      targetFileName: file.name,
      accepted: false,
      completed: false,
    };
    this.state.missions.push(mission);
  }

  runPassiveTraceAudit(startIp: string): boolean {
    let currentIp = startIp;
    let downstreamIp: string | null = null;
    const visited = new Set<string>();

    for (let step = 0; step < 32; step++) {
      if (currentIp === this.state.player.gateway.ip) {
        const origin = this.state.servers[startIp];
        if (origin) {
          this.handleCaughtHacking(
            origin,
            `Passive trace audit from ${startIp} followed your bounce logs back to your gateway.`
          );
        } else {
          this.disavowPlayer(
            `Passive trace audit from ${startIp} followed your bounce logs back to your gateway.`
          );
        }
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
    if (!m || m.accepted || m.completed || m.failed) return false;
    m.accepted = true;
    const target = this.state.servers[m.targetIp];
    if (target) target.discovered = true;
    this.events.emit({ type: "mission.accepted", missionId });
    return true;
  }

  completeMission(missionId: string): boolean {
    const m = this.state.missions.find((x) => x.id === missionId);
    if (!m || !m.accepted || m.completed || m.failed) return false;

    if (m.kind === "pay_fine" && m.targetAmount) {
      if (this.state.player.credits < m.targetAmount) {
        this.events.emit({ type: "notice", level: "warn", message: "Insufficient credits to pay fine." });
        return false;
      }
      this.state.player.credits -= m.targetAmount;
      m.completed = true;
      this.events.emit({ type: "mission.completed", missionId: m.id, payment: -m.targetAmount });
      return true;
    }

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
    } else if (m.kind === "remove_computer") {
      if (!target.destroyed) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${target.name} is still operational. Delete /sys and run 'shutdown' in Remote Console.`,
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
    } else if (m.kind === "frame_user" && m.targetCitizenId) {
      const cit = this.state.citizens[m.targetCitizenId];
      if (!cit || !cit.arrestWarrant || cit.criminalHistory.length === 0) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${cit?.fullName ?? "Target"} needs both a criminal conviction and an active arrest warrant.`,
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
    } else if (m.kind === "change_medical" && m.targetCitizenId) {
      const cit = this.state.citizens[m.targetCitizenId];
      if (!cit || !cit.medicalHistory.some((h) => h === m.targetValue)) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${cit?.fullName ?? "Target"}'s medical record has not been updated to "${m.targetValue}".`,
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
    } else if (m.kind === "story_special") {
      if (m.specialMissionCode === "MAIDEN_FLIGHT" && !target.revelationInfected) {
        this.events.emit({ type: "notice", level: "warn", message: `Deploy Revelation on ${target.name} first.` });
        return false;
      }
      if (m.specialMissionCode === "BACKFIRE" && m.targetFileName) {
        const idx = this.state.player.gateway.files.findIndex(
          (f) => f.name === m.targetFileName && f.encryptedLevel === 0
        );
        if (idx === -1) {
          this.events.emit({
            type: "notice",
            level: "warn",
            message: `Copy and decrypt ${m.targetFileName} from ARC first.`,
          });
          return false;
        }
        this.state.player.gateway.files.splice(idx, 1);
      }
      if (m.specialMissionCode === "GRAND_TOUR" && this.state.story.stage !== "arc_victory") {
        this.events.emit({ type: "notice", level: "warn", message: "Revelation has not reached critical mass yet." });
        return false;
      }
      if (m.specialMissionCode === "COUNTERATTACK" && this.state.story.stage !== "arunmor_victory") {
        this.events.emit({ type: "notice", level: "warn", message: "Faith has not neutralized Revelation yet." });
        return false;
      }
      if (m.specialMissionCode) {
        this.state.story.completedSpecialMissions.push(m.specialMissionCode);
      }
    }

    m.completed = true;
    this.state.player.credits += m.payment;
    this.state.player.uplinkScore += m.difficulty * 3;
    this.state.player.neuromancerScore += (NEUROMANCER_MISSION_DELTA[m.kind] ?? 0) * m.difficulty;

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

  buyModem(modemId: string): boolean {
    const spec = MODEM_CATALOG.find((m) => m.id === modemId);
    if (!spec) return false;
    if (this.state.player.credits < spec.cost) return false;
    if (this.state.player.gateway.modemGbps >= spec.gbps) return false;

    this.state.player.credits -= spec.cost;
    this.state.player.gateway.modemGbps = spec.gbps;
    this.events.emit({ type: "notice", level: "info", message: `Installed ${spec.name}` });
    return true;
  }

  buyMemory(memId: string): boolean {
    const spec = MEMORY_CATALOG.find((m) => m.id === memId);
    const gwSpec = GATEWAY_CATALOG.find((g) => g.id === this.state.player.gateway.specId);
    if (!spec || !gwSpec) return false;
    if (this.state.player.credits < spec.cost) return false;
    if (this.state.player.gateway.memoryTotalGq + spec.gq > gwSpec.maxMemoryGq) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `Exceeds ${gwSpec.name} max memory (${gwSpec.maxMemoryGq} Gq). Upgrade gateway first.`,
      });
      return false;
    }

    this.state.player.credits -= spec.cost;
    this.state.player.gateway.memoryTotalGq += spec.gq;
    this.events.emit({ type: "notice", level: "info", message: `Installed ${spec.name}` });
    return true;
  }

  buyGatewaySecurity(deviceId: GatewaySecurityDevice): boolean {
    const spec = GATEWAY_SECURITY_CATALOG.find((d) => d.id === deviceId);
    const gwSpec = GATEWAY_CATALOG.find((g) => g.id === this.state.player.gateway.specId);
    if (!spec || !gwSpec) return false;
    if (this.state.player.credits < spec.cost) return false;
    if (this.state.player.gateway.securityDevices.includes(deviceId)) return false;
    if (this.state.player.gateway.securityDevices.length >= gwSpec.maxSecuritySlots) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: `All ${gwSpec.maxSecuritySlots} security slot(s) occupied on ${gwSpec.name}.`,
      });
      return false;
    }

    this.state.player.credits -= spec.cost;
    this.state.player.gateway.securityDevices.push(deviceId);
    this.events.emit({ type: "notice", level: "info", message: `Installed ${spec.name}` });
    return true;
  }

  upgradeGateway(specId: string): boolean {
    const spec = GATEWAY_CATALOG.find((g) => g.id === specId);
    const curSpec = GATEWAY_CATALOG.find((g) => g.id === this.state.player.gateway.specId);
    if (!spec) return false;
    if (this.state.player.gateway.specId === spec.id) return false;

    const tradeIn = curSpec ? Math.round(curSpec.cost * PLAYER_DEFAULTS.gatewayPartExchangeRate) : 0;
    const netCost = Math.max(0, spec.cost - tradeIn);
    if (this.state.player.credits < netCost) return false;

    this.state.player.credits -= netCost;
    this.state.player.gateway.specId = spec.id;
    this.state.player.gateway.gatewayIdNumber += 1;
    this.state.player.gateway.memoryTotalGq = Math.max(
      this.state.player.gateway.memoryTotalGq,
      Math.min(spec.maxMemoryGq, Math.max(24, Math.floor(spec.maxMemoryGq / 2)))
    );
    this.state.player.gateway.bandwidthGbps = spec.bandwidthGbps;
    this.events.emit({
      type: "notice",
      level: "info",
      message: `Upgraded to ${spec.name} (net ${netCost.toLocaleString()}c after 75% trade-in).`,
    });
    return true;
  }

  /** Helper exposing canonical InterNIC IP */
  getInternicIp(): string {
    return FIXED_IPS.INTERNIC;
  }
}
