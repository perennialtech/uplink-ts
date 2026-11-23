import {
  CPU_CATALOG,
  GATEWAY_CATALOG,
  SECURITY_LEVEL_MODIFIER,
  SOFTWARE_CATALOG,
  TASK_TICKS,
  TRACE_BOUNCE_MODIFIER,
} from "./catalog";
import { EventBus } from "./events";
import { SeededRng } from "./rng";
import type {
  AccessLevel,
  LogEntry,
  RunningTask,
  ServerNode,
  SoftwareId,
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

  // ---------------------------------------------------------------------------
  // Time Control
  // ---------------------------------------------------------------------------

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

  /**
   * Computes exact per-hop trace seconds from target back to gateway,
   * matching Uplink's access-level bounce modifiers.
   */
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
    // Trace walks backwards from target (index route.length - 1) down to gateway (index 0)
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
    this.state.connection.traceActive = false;
    this.state.connection.traceHopsCompleted = 0;
    this.state.connection.secondsUntilNextHop = 0;
    this.state.connection.totalTraceSecondsRemaining = 0;
    this.state.connection.totalTraceSecondsInitial = 0;

    // Record bounce logs on every intermediate node + connection log on target
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

    // If any security system on target is already disabled, start trace immediately
    if (target.security.some((s) => !s.enabled)) {
      this.beginTrace();
    }

    this.events.emit({
      type: "connection.opened",
      targetIp,
      hops: route.length - 1,
    });
    return true;
  }

  disconnect(): void {
    const target = this.getTargetServer();
    if (!target) return;

    // Stop non-persistent remote tasks
    this.state.tasks = this.state.tasks.filter(
      (t) => t.kind === "trace_tracker" || t.targetIp !== target.ip
    );

    // Reset temporary bypass states on the target
    for (const sec of target.security) {
      sec.bypassed = false;
    }

    // Schedule passive trace check if we triggered an active trace or modified/stole anything
    if (this.state.connection.traceActive && target.traceSpeedSec > 0) {
      this.schedulePassiveTrace(target.ip);
    }

    const targetIp = target.ip;
    this.state.connection.connected = false;
    this.state.connection.authenticatedAs = "none";
    delete this.state.connection.authenticatedUser;
    this.state.connection.traceActive = false;
    this.state.connection.traceHopsCompleted = 0;
    this.state.connection.secondsUntilNextHop = 0;
    this.state.connection.totalTraceSecondsRemaining = 0;

    this.events.emit({ type: "connection.closed", targetIp });
  }

  beginTrace(): void {
    const conn = this.state.connection;
    if (!conn.connected || conn.traceActive) return;
    const target = this.getTargetServer();
    if (!target || target.traceSpeedSec <= 0) return;

    // Monitor bypass prevents trace initiation while active
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

    this.events.emit({
      type: "trace.started",
      targetIp: target.ip,
      totalSeconds: total,
    });
  }

  // ---------------------------------------------------------------------------
  // Authentication & Remote Actions
  // ---------------------------------------------------------------------------

  login(username: string, password: string): boolean {
    const target = this.getTargetServer();
    if (!target) return false;
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
  // Task Manager (Cooperative CPU Scheduler — clean VanBakel replacement)
  // ---------------------------------------------------------------------------

  startTask(kind: TaskKind, targetRef?: string): RunningTask | null {
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
    if (kind !== "trace_tracker" && !target) {
      this.events.emit({
        type: "notice",
        level: "warn",
        message: "Connect to a target server first.",
      });
      return null;
    }

    // Prevent duplicate persistent tools
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

    if (target) {
      if (kind === "password_breaker") {
        const acct =
          target.accounts.find((a) => a.username === (targetRef ?? "admin")) ??
          target.accounts[0];
        if (!acct) return null;
        const secMod = SECURITY_LEVEL_MODIFIER[acct.securityLevel] ?? 1.0;
        const totalTicks = Math.max(15, target.hackDifficulty * secMod * acct.password.length);
        task.meta = {
          username: acct.username,
          password: acct.password,
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
      } else if (kind === "log_deleter") {
        if (this.state.connection.authenticatedAs !== "admin") {
          this.events.emit({ type: "notice", level: "warn", message: "Admin access required to edit logs." });
          return null;
        }
        const log = target.logs.find((l) => l.id === targetRef);
        if (!log) return null;
        task.meta = { ticksDone: 0 };
        task.statusText = `Erasing log (v${version})...`;
      } else if (kind === "lan_scan") {
        task.meta = { ticksDone: 0 };
        task.statusText = "Scanning LAN topology...";
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
  // Main Fixed-Timestep Tick
  // ---------------------------------------------------------------------------

  tick(deltaRealSec: number): void {
    if (this.state.player.disavowed || this.state.timeScale === 0 || deltaRealSec <= 0) {
      return;
    }

    const simSec = deltaRealSec * this.state.timeScale;
    this.state.timeMs += Math.round(simSec * 1000);

    this.tickTrace(simSec);
    this.tickTasks(simSec);
    this.tickScheduledEvents();
    this.state.rngState = this.rng.getState();
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

      // Baseline: 60 GHz yields 60 ticks/sec
      const ticks = task.allocatedGhz * simSec;
      const target = this.state.servers[task.targetIp];
      if (!target) {
        completedIds.push(task.id);
        continue;
      }

      if (task.kind === "password_breaker" && task.meta) {
        const totalTicks = Number(task.meta.totalTicks ?? 100);
        const password = String(task.meta.password ?? "");
        const username = String(task.meta.username ?? "admin");
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / totalTicks);

        const revealed = Math.floor(task.progress * password.length);
        let display = password.slice(0, revealed);
        for (let i = revealed; i < password.length; i++) {
          display += ALPHABET[Math.floor(this.rng.next() * ALPHABET.length)]!;
        }
        task.statusText = `Cracking ${username}: ${display}`;

        if (task.progress >= 1) {
          task.completed = true;
          this.login(username, password);
          this.events.emit({
            type: "task.completed",
            taskId: task.id,
            kind: task.kind,
            summary: `Password cracked for ${username} (${password})`,
          });
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
              // Clean wipe: removes log completely so passive traces hit a dead end
              target.logs.splice(logIdx, 1);
            } else {
              // v1-v3 leaves a recoverable/suspicious stub
              log.suspiciousDeletion = true;
              log.originalDetail = log.detail;
              log.originalFromIp = log.fromIp;
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
      } else if (task.kind === "lan_scan" && task.meta) {
        const ticksDone = Number(task.meta.ticksDone ?? 0) + ticks;
        task.meta.ticksDone = ticksDone;
        task.progress = Math.min(1, ticksDone / TASK_TICKS.lanScan);
        if (task.progress >= 1 && target.lanNodes) {
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
    const delayMs = this.rng.int(3, 6) * 3600 * 1000; // 3-6 in-game hours
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
        const targetIp = String(evt.payload.targetIp ?? "");
        this.runPassiveTraceAudit(targetIp);
      }
    }
  }

  /**
   * Walks backward from targetIp through bounce logs.
   * Stops if a bounce node has no forwarding log (cleanly wiped with Log Deleter v4).
   * Succeeds (player caught!) if logs lead all the way to the player's gateway IP.
   */
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

      // On the victim server (step 0), follow the connection log; on bounce nodes,
      // only follow a bounce log that routed specifically to downstreamIp (or a recoverable v1-v3 stub).
      const traceLog = srv.logs.find((l) => {
        const src = l.originalFromIp ?? l.fromIp;
        if (src === currentIp) return false;
        if (downstreamIp === null) {
          return l.type === "connection" || l.suspiciousDeletion;
        }
        return (l.type === "bounce" && l.toIp === downstreamIp) || (l.suspiciousDeletion && l.toIp === downstreamIp);
      });
      if (!traceLog) {
        // Trail went cold — player cleanly scrubbed bounce logs!
        return false;
      }
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

    if (m.kind === "steal_file" && m.targetFileName) {
      const idx = this.state.player.gateway.files.findIndex((f) => f.name === m.targetFileName);
      if (idx === -1) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `You haven't copied ${m.targetFileName} to your gateway yet.`,
        });
        return false;
      }
      this.state.player.gateway.files.splice(idx, 1);
    } else if (m.kind === "destroy_file" && m.targetFileName) {
      const stillExists = target.files.some((f) => f.name === m.targetFileName);
      if (stillExists) {
        this.events.emit({
          type: "notice",
          level: "warn",
          message: `${m.targetFileName} still exists on ${target.name}.`,
        });
        return false;
      }
    }

    m.completed = true;
    this.state.player.credits += m.payment;
    this.state.player.uplinkScore += m.difficulty * 3;
    this.state.player.neuromancerScore += m.kind === "destroy_file" ? 5 : 0;

    this.state.emails.unshift({
      id: this.nextId("email"),
      from: `contracts@${m.employer.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
      subject: `Payment Received: ${m.title}`,
      body: `Contract verified. ${m.payment.toLocaleString()} credits have been wired to your account.`,
      timestampMs: this.state.timeMs,
      read: false,
      missionId: m.id,
    });

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
      // Replace the slowest CPU
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
