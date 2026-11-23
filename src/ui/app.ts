import {
  clearSlot,
  CPU_CATALOG,
  createInitialWorld,
  deserializeState,
  FAITH_WIN_THRESHOLD,
  formatGameDate,
  formatSeconds,
  GATEWAY_CATALOG,
  getNeuromancerRatingName,
  getUplinkRatingName,
  isOnLanMainServer,
  loadFromSlot,
  REVELATION_WIN_THRESHOLD,
  saveToSlot,
  serializeState,
  SOFTWARE_CATALOG,
  UplinkEngine,
  type GameEvent,
  type ServerNode,
  type SoftwareId,
} from "../engine";
import { SoundSynth } from "./audio";
import { findClickedLanNode, renderLanCanvas } from "./lanView";
import { WorldMapRenderer } from "./worldMap";

type LocalTab = "missions" | "shop" | "gateway" | "news" | "inbox";

export class UplinkApp {
  private root: HTMLElement;
  private engine: UplinkEngine;
  private synth = new SoundSynth();
  private mapRenderer: WorldMapRenderer | null = null;
  private activeTab: LocalTab = "missions";
  private selectedLanNodeId: string | null = null;
  private feed: string[] = [];
  private lastFrameMs = performance.now();
  private uiAccum = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.engine = new UplinkEngine(createInitialWorld("Agent"));
    this.engine.events.subscribe((ev) => this.onGameEvent(ev));
    this.logFeed("Gateway online. Click nodes on the map to plot a bounce route.");
    this.mountSkeleton();
    this.renderUi();

    void loadFromSlot("primary").then((saved) => {
      if (saved) {
        this.engine.loadState(saved);
        this.logFeed("Loaded saved agent from browser storage.");
        this.renderUi();
      }
    });

    requestAnimationFrame((t) => this.loop(t));
  }

  private onGameEvent(ev: GameEvent): void {
    this.synth.handleEvent(ev);
    switch (ev.type) {
      case "connection.opened":
        this.selectedLanNodeId = null;
        this.logFeed(`Connected to ${ev.targetIp} via ${ev.hops} hop(s).`);
        break;
      case "connection.closed":
        this.selectedLanNodeId = null;
        this.logFeed(`Disconnected from ${ev.targetIp}.`);
        break;
      case "auth.succeeded":
        this.logFeed(`Authenticated as ${ev.username} (${ev.level}).`);
        break;
      case "trace.started":
        this.logFeed(`WARNING: Active trace started (~${Math.ceil(ev.totalSeconds)}s).`);
        break;
      case "trace.hop":
        this.logFeed(`Trace reached ${ev.hopIp} (${ev.hopsRemaining} hop(s) left).`);
        break;
      case "lan.sysadmin_alert":
        this.logFeed("ALERT: LAN Sysadmin is tracking your node!");
        break;
      case "lan.caught":
        this.logFeed("LAN Sysadmin caught you and severed the connection!");
        break;
      case "task.completed":
        this.logFeed(ev.summary);
        break;
      case "mission.completed":
        this.logFeed(`Contract complete! +${ev.payment.toLocaleString()}c`);
        break;
      case "story.updated":
        this.logFeed(`STORY: ${ev.headline}`);
        break;
      case "player.disavowed":
        this.logFeed(`DISAVOWED: ${ev.reason}`);
        break;
      case "notice":
        this.logFeed(ev.message);
        break;
      default:
        break;
    }
    this.renderUi();
  }

  private logFeed(msg: string): void {
    const stamp = formatGameDate(this.engine.getState().timeMs).slice(11);
    this.feed.unshift(`[${stamp}] ${msg}`);
    if (this.feed.length > 35) this.feed.length = 35;
  }

  private mountSkeleton(): void {
    this.root.innerHTML = `
      <div class="shell">
        <header class="topbar" id="topbar"></header>
        <div id="disavowed-slot"></div>
        <main class="workspace">
          <section class="card">
            <h2>Global Bounce Map</h2>
            <canvas id="world-map" width="1000" height="500"></canvas>
            <div class="controls" id="route-controls"></div>
            <div class="list" id="server-links" style="max-height:155px"></div>
          </section>
          <section class="card" id="right-panel"></section>
        </main>
        <footer class="bottom-dock">
          <section class="card">
            <h2>CPU Task Manager</h2>
            <div class="list" id="task-list" style="max-height:165px"></div>
          </section>
          <section class="card">
            <h2>Event Log</h2>
            <div class="list" id="event-feed" style="max-height:165px"></div>
          </section>
        </footer>
      </div>
    `;

    const canvas = this.root.querySelector<HTMLCanvasElement>("#world-map")!;
    this.mapRenderer = new WorldMapRenderer(canvas, (ip) => {
      if (this.engine.addBounceNode(ip)) {
        this.synth.beep(600, 0.04, "sine", 0.03);
        this.renderUi();
      }
    });
  }

  private loop(now: number): void {
    const dt = Math.min(0.25, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;

    this.engine.tick(dt);
    this.mapRenderer?.render(this.engine.getState(), now);

    const lanCanvas = this.root.querySelector<HTMLCanvasElement>("#lan-canvas");
    const target = this.engine.getTargetServer();
    const lanSession = this.engine.getState().connection.lanSession;
    if (lanCanvas && target?.lanNodes && lanSession) {
      renderLanCanvas(lanCanvas, target.lanNodes, lanSession, this.selectedLanNodeId);
    }

    this.uiAccum += dt;
    if (this.uiAccum >= 0.15) {
      this.uiAccum = 0;
      this.renderTopbar();
      this.renderTasks();
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private renderUi(): void {
    this.renderTopbar();
    this.renderDisavowedBanner();
    this.renderRouteControls();
    this.renderRightPanel();
    this.renderTasks();
    this.renderFeed();
  }

  private renderTopbar(): void {
    const s = this.engine.getState();
    const topbar = this.root.querySelector<HTMLElement>("#topbar")!;
    const usedMem = this.engine.getUsedMemoryGq();
    const totalCpu = this.engine.getTotalCpuGhz();

    topbar.innerHTML = `
      <div class="brand">UPLINK // TS</div>
      <div class="metrics">
        <span class="pill">${formatGameDate(s.timeMs)}</span>
        <span class="pill">${s.player.credits.toLocaleString()}c</span>
        <span class="pill">${getUplinkRatingName(s.player.uplinkScore)} · ${getNeuromancerRatingName(s.player.neuromancerScore)}</span>
        <span class="pill">CPU ${totalCpu} GHz</span>
        <span class="pill">MEM ${usedMem}/${s.player.gateway.memoryTotalGq} Gq</span>
      </div>
      <div class="controls">
        ${([0, 1, 2, 4, 60] as const)
          .map(
            (spd) =>
              `<button data-speed="${spd}" class="${s.timeScale === spd ? "primary" : ""}">${spd === 0 ? "||" : `${spd}x`}</button>`
          )
          .join("")}
        <button id="btn-save">Save</button>
        <button id="btn-export">Export</button>
        <button id="btn-reset" class="danger">New World</button>
      </div>
    `;

    topbar.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((btn) => {
      btn.onclick = () => {
        this.engine.setTimeScale(Number(btn.dataset.speed) as 0 | 1 | 2 | 4 | 60);
        this.renderTopbar();
      };
    });
    topbar.querySelector<HTMLButtonElement>("#btn-save")!.onclick = () => {
      void saveToSlot("primary", this.engine.getState()).then(() => {
        this.logFeed("Saved agent to IndexedDB.");
        this.renderFeed();
      });
    };
    topbar.querySelector<HTMLButtonElement>("#btn-export")!.onclick = () => {
      const blob = new Blob([serializeState(this.engine.getState())], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `uplink-ts-${s.player.handle}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    topbar.querySelector<HTMLButtonElement>("#btn-reset")!.onclick = () => {
      void clearSlot("primary");
      this.engine.loadState(createInitialWorld("Agent", Math.floor(Math.random() * 1_000_000)));
      this.logFeed("Generated fresh procedural world.");
      this.renderUi();
    };
  }

  private renderDisavowedBanner(): void {
    const s = this.engine.getState();
    const slot = this.root.querySelector<HTMLElement>("#disavowed-slot")!;
    if (!s.player.disavowed) {
      slot.innerHTML = "";
      return;
    }
    slot.innerHTML = `
      <div class="banner-danger">
        <div><strong>AGENT DISAVOWED:</strong> ${s.player.disavowedReason ?? "Traced."}</div>
        <button id="btn-restart" class="primary">Start New Agent</button>
      </div>
    `;
    slot.querySelector<HTMLButtonElement>("#btn-restart")!.onclick = () => {
      void clearSlot("primary");
      this.engine.loadState(createInitialWorld("Agent", Math.floor(Math.random() * 1_000_000)));
      this.renderUi();
    };
  }

  private renderRouteControls(): void {
    const s = this.engine.getState();
    const rc = this.root.querySelector<HTMLElement>("#route-controls")!;
    const hops = Math.max(0, s.connection.route.length - 1);
    const estTrace =
      hops > 0 ? this.engine.computeTotalTraceSeconds(s.connection.route) : Number.POSITIVE_INFINITY;

    rc.innerHTML = `
      ${
        s.connection.connected
          ? `<button id="btn-disconnect" class="danger">Disconnect</button>`
          : `<button id="btn-connect" class="primary" ${hops === 0 ? "disabled" : ""}>Connect (${hops} hops)</button>`
      }
      <button id="btn-undo" ${s.connection.connected || hops === 0 ? "disabled" : ""}>Undo Hop</button>
      <button id="btn-clear" ${s.connection.connected || hops === 0 ? "disabled" : ""}>Clear</button>
      <button id="btn-save-route" ${hops === 0 ? "disabled" : ""}>Save Route</button>
      <button id="btn-load-route" ${s.connection.connected ? "disabled" : ""}>Load Route</button>
      <span class="muted">Est. Trace: ${Number.isFinite(estTrace) ? formatSeconds(estTrace) : "None"}</span>
    `;

    const connBtn = rc.querySelector<HTMLButtonElement>("#btn-connect");
    if (connBtn) connBtn.onclick = () => { this.engine.connect(); this.renderUi(); };
    const discBtn = rc.querySelector<HTMLButtonElement>("#btn-disconnect");
    if (discBtn) discBtn.onclick = () => { this.engine.disconnect(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-undo")!.onclick = () => { this.engine.removeLastBounceNode(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-clear")!.onclick = () => { this.engine.clearRoute(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-save-route")!.onclick = () => { this.engine.saveBounceRoute(); this.logFeed("Saved bounce route."); this.renderFeed(); };
    rc.querySelector<HTMLButtonElement>("#btn-load-route")!.onclick = () => { this.engine.loadBounceRoute(); this.renderUi(); };

    const links = this.root.querySelector<HTMLElement>("#server-links")!;
    const discovered = Object.values(s.servers).filter((srv) => srv.discovered);
    links.innerHTML = discovered
      .map(
        (srv) => `
        <div class="row">
          <div>
            <strong>${srv.name}</strong>
            <span class="muted">${srv.ip} · ${srv.playerAccess}${srv.revelationInfected ? " · [REVELATION]" : ""}${srv.faithProtected ? " · [FAITH]" : ""}</span>
          </div>
          <button data-add-ip="${srv.ip}" ${s.connection.connected || s.connection.route.includes(srv.ip) ? "disabled" : ""}>+ Bounce</button>
        </div>`
      )
      .join("");

    links.querySelectorAll<HTMLButtonElement>("[data-add-ip]").forEach((btn) => {
      btn.onclick = () => {
        this.engine.addBounceNode(btn.dataset.addIp!);
        this.renderUi();
      };
    });
  }

  private renderRightPanel(): void {
    const panel = this.root.querySelector<HTMLElement>("#right-panel")!;
    const target = this.engine.getTargetServer();
    if (target) {
      this.renderRemoteServer(panel, target);
    } else {
      this.renderLocalDashboard(panel);
    }
  }

  private renderRemoteServer(panel: HTMLElement, target: ServerNode): void {
    const s = this.engine.getState();
    const auth = s.connection.authenticatedAs;
    const lanReady = !target.lanNodes || isOnLanMainServer(target.lanNodes, s.connection.lanSession);

    const hasRev = this.engine.getHighestSoftwareVersion("revelation") > 0;
    const hasFaith = this.engine.getHighestSoftwareVersion("faith") > 0;

    panel.innerHTML = `
      <h2>Remote: ${target.name} (${target.ip})</h2>
      <div class="controls">
        <span class="pill">Access: ${auth.toUpperCase()}</span>
        ${target.security
          .map(
            (sec) =>
              `<span class="pill">${sec.kind.toUpperCase()} L${sec.level}: ${sec.bypassed ? "BYPASSED" : sec.enabled ? "ACTIVE" : "OFF"}</span>`
          )
          .join("")}
      </div>
      <div class="controls">
        <button id="btn-tracker">Trace Tracker</button>
        ${auth === "none" && lanReady ? `<button id="btn-crack" class="primary">Password Breaker</button><button id="btn-dict">Dictionary Hacker</button>` : ""}
        ${target.security.some((x) => x.kind === "proxy" && x.enabled) ? `<button id="btn-proxy-dis">Disable Proxy</button><button id="btn-proxy-byp">Bypass Proxy</button>` : ""}
        ${target.security.some((x) => x.kind === "firewall" && x.enabled) ? `<button id="btn-fw-dis">Disable Firewall</button><button id="btn-fw-byp">Bypass Firewall</button>` : ""}
        ${target.security.some((x) => x.kind === "monitor" && x.enabled) ? `<button id="btn-mon-byp">Bypass Monitor</button>` : ""}
        ${auth === "admin" && hasRev ? `<button id="btn-deploy-rev" class="danger">Deploy REVELATION</button>` : ""}
        ${auth === "admin" && hasFaith ? `<button id="btn-deploy-faith" class="primary">Deploy FAITH</button>` : ""}
      </div>

      ${target.lanNodes ? this.buildLanHtml(target) : ""}
      ${target.kind === "bank" ? this.buildBankHtml(target) : ""}
      ${(target.kind === "database_academic" || target.kind === "database_criminal" || target.kind === "database_social") && auth !== "none" ? this.buildGovDbHtml(target) : ""}

      ${
        auth === "none" && lanReady && target.kind !== "bank"
          ? `<div class="row">
               <div>Manual Admin Login</div>
               <div class="controls">
                 <input id="manual-pw" type="password" placeholder="password" style="background:#050912;color:#fff;border:1px solid #1e3252;padding:4px 6px;" />
                 <button id="btn-manual-login">Login</button>
               </div>
             </div>`
          : ""
      }

      ${
        auth !== "none" && lanReady && target.kind !== "bank"
          ? `
        <div><strong>Files (${target.files.length})</strong></div>
        <div class="list" style="max-height:110px">
          ${
            target.files.length === 0
              ? `<div class="muted">No files on server.</div>`
              : target.files
                  .map(
                    (f) => `
                <div class="row">
                  <div>${f.name} <span class="muted">(${f.sizeGq} Gq${f.encryptedLevel > 0 ? `, Enc L${f.encryptedLevel}` : ""})</span></div>
                  <div class="controls">
                    <button data-copy="${f.id}">Copy</button>
                    <button data-del="${f.id}" class="danger">Delete</button>
                  </div>
                </div>`
                  )
                  .join("")
          }
        </div>
        <div><strong>Server Logs (${target.logs.length})</strong></div>
        <div class="list" style="max-height:125px">
          ${
            target.logs.length === 0
              ? `<div class="muted">No logs recorded.</div>`
              : target.logs
                  .slice(0, 12)
                  .map(
                    (l) => `
                <div class="row">
                  <div class="muted">${formatGameDate(l.timestampMs).slice(11)} · ${l.detail}</div>
                  ${
                    auth === "admin"
                      ? `<div class="controls">
                           <button data-wipe-log="${l.id}">Wipe</button>
                           ${l.suspiciousDeletion ? `<button data-undel-log="${l.id}">Recover</button>` : `<button data-mod-log="${l.id}">Spoof IP</button>`}
                         </div>`
                      : ""
                  }
                </div>`
                  )
                  .join("")
          }
        </div>
      `
          : ""
      }
    `;

    this.bindRemoteHandlers(panel, target);
  }

  private buildLanHtml(target: ServerNode): string {
    const sel = target.lanNodes?.find((n) => n.id === this.selectedLanNodeId);
    const session = this.engine.getState().connection.lanSession;
    return `
      <div class="card" style="padding:8px;background:#070d1a;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>LAN Topology ${session?.sysadminAlerted ? "(SYSADMIN ALERTED!)" : ""}</strong>
          <div class="controls">
            <button id="btn-lan-scan">LAN Scan</button>
            ${sel ? `<button id="btn-lan-move" class="primary">Move to ${sel.label}</button>` : ""}
            ${sel ? `<button id="btn-lan-probe">Probe</button>` : ""}
            ${sel?.kind === "auth_server" ? `<button id="btn-lan-spoof">Spoof</button>` : ""}
            ${sel && !sel.unlocked ? `<button id="btn-lan-force" class="danger">Force Lock</button>` : ""}
          </div>
        </div>
        <canvas id="lan-canvas" width="560" height="270" style="width:100%;height:auto;border:1px solid #1e3252;border-radius:4px;cursor:pointer;"></canvas>
      </div>
    `;
  }

  private buildBankHtml(target: ServerNode): string {
    const s = this.engine.getState();
    const acctNum = s.connection.authenticatedBankAccount;
    const acct = target.bankAccounts.find((a) => a.accountNumber === acctNum);
    if (!acct) {
      return `
        <div><strong>Bank Accounts on ${target.name}</strong></div>
        <div class="list" style="max-height:220px">
          ${target.bankAccounts
            .map(
              (a) => `
              <div class="row">
                <div><strong>#${a.accountNumber}</strong> · ${a.ownerName}</div>
                <div class="controls">
                  ${a.accountNumber === s.player.bankAccountNumber ? `<button data-bank-login="${a.accountNumber}" data-bank-pw="${a.password}" class="primary">Login (Own)</button>` : `<button data-bank-crack="${a.accountNumber}" class="primary">Crack Acct</button>`}
                </div>
              </div>`
            )
            .join("")}
        </div>
      `;
    }

    return `
      <div class="row">
        <div><strong>Account #${acct.accountNumber} (${acct.ownerName})</strong></div>
        <div><strong>${acct.balance.toLocaleString()}c</strong></div>
      </div>
      <div class="row">
        <div>Wire to Your Account (#${s.player.bankAccountNumber})</div>
        <div class="controls">
          <input id="bank-xfer-amt" type="number" value="5000" style="width:90px;background:#050912;color:#fff;border:1px solid #1e3252;padding:4px 6px;" />
          <button id="btn-bank-xfer" class="primary">Transfer</button>
        </div>
      </div>
      <div><strong>Statements (${acct.statements.length})</strong></div>
      <div class="list" style="max-height:130px">
        ${
          acct.statements.length === 0
            ? `<div class="muted">No transfer statements on record.</div>`
            : acct.statements
                .map(
                  (st) => `
                  <div class="row">
                    <div class="muted">${st.amount > 0 ? "+" : ""}${st.amount.toLocaleString()}c · ${st.note}</div>
                    <button data-del-stmt="${st.id}" class="danger">Delete Statement</button>
                  </div>`
                )
                .join("")
        }
      </div>
    `;
  }

  private buildGovDbHtml(target: ServerNode): string {
    const citizens = Object.values(this.engine.getState().citizens);
    return `
      <div><strong>${target.name} Registry</strong></div>
      <div class="list" style="max-height:180px">
        ${citizens
          .map((c) => {
            if (target.kind === "database_academic") {
              return `
                <div class="row">
                  <div><strong>${c.fullName}</strong> <span class="muted">${c.degree} · GPA ${c.gpa}</span></div>
                  <button data-set-gpa="${c.id}" class="primary">Set GPA 4.0</button>
                </div>`;
            }
            if (target.kind === "database_criminal") {
              return `
                <div class="row">
                  <div><strong>${c.fullName}</strong> <span class="muted">Records: ${c.criminalHistory.length}${c.arrestWarrant ? " [WARRANT]" : ""}</span></div>
                  <div class="controls">
                    <button data-clear-crime="${c.id}">Clear</button>
                    <button data-frame-crime="${c.id}" class="danger">Frame</button>
                  </div>
                </div>`;
            }
            return `
              <div class="row">
                <div><strong>${c.fullName}</strong> <span class="muted">SSN ${c.ssn} · ${c.employment}</span></div>
                <button data-set-emp="${c.id}">Set Meridian Logistics</button>
              </div>`;
          })
          .join("")}
      </div>
    `;
  }

  private bindRemoteHandlers(panel: HTMLElement, target: ServerNode): void {
    panel.querySelector<HTMLButtonElement>("#btn-tracker")!.onclick = () => this.engine.startTask("trace_tracker");
    const crackBtn = panel.querySelector<HTMLButtonElement>("#btn-crack");
    if (crackBtn) crackBtn.onclick = () => this.engine.startTask("password_breaker", "admin");
    const dictBtn = panel.querySelector<HTMLButtonElement>("#btn-dict");
    if (dictBtn) dictBtn.onclick = () => this.engine.startTask("dictionary_hacker", "admin");
    const proxyDis = panel.querySelector<HTMLButtonElement>("#btn-proxy-dis");
    if (proxyDis) proxyDis.onclick = () => this.engine.startTask("proxy_disable");
    const proxyByp = panel.querySelector<HTMLButtonElement>("#btn-proxy-byp");
    if (proxyByp) proxyByp.onclick = () => this.engine.startTask("proxy_bypass");
    const fwDis = panel.querySelector<HTMLButtonElement>("#btn-fw-dis");
    if (fwDis) fwDis.onclick = () => this.engine.startTask("firewall_disable");
    const fwByp = panel.querySelector<HTMLButtonElement>("#btn-fw-byp");
    if (fwByp) fwByp.onclick = () => this.engine.startTask("firewall_bypass");
    const monByp = panel.querySelector<HTMLButtonElement>("#btn-mon-byp");
    if (monByp) monByp.onclick = () => this.engine.startTask("monitor_bypass");
    const depRev = panel.querySelector<HTMLButtonElement>("#btn-deploy-rev");
    if (depRev) depRev.onclick = () => { this.engine.deployStoryPayload("revelation"); this.renderUi(); };
    const depFaith = panel.querySelector<HTMLButtonElement>("#btn-deploy-faith");
    if (depFaith) depFaith.onclick = () => { this.engine.deployStoryPayload("faith"); this.renderUi(); };

    const loginBtn = panel.querySelector<HTMLButtonElement>("#btn-manual-login");
    if (loginBtn) {
      loginBtn.onclick = () => {
        const pw = panel.querySelector<HTMLInputElement>("#manual-pw")!.value;
        if (!this.engine.login("admin", pw)) {
          this.logFeed("Invalid password.");
          this.renderFeed();
        }
      };
    }

    // LAN handlers
    const lanCanvas = panel.querySelector<HTMLCanvasElement>("#lan-canvas");
    if (lanCanvas && target.lanNodes) {
      lanCanvas.onclick = (ev) => {
        const clicked = findClickedLanNode(lanCanvas, ev, target.lanNodes!);
        if (clicked) {
          this.selectedLanNodeId = clicked.id;
          this.renderRightPanel();
        }
      };
    }
    const lanScan = panel.querySelector<HTMLButtonElement>("#btn-lan-scan");
    if (lanScan) lanScan.onclick = () => this.engine.startTask("lan_scan");
    const lanMove = panel.querySelector<HTMLButtonElement>("#btn-lan-move");
    if (lanMove && this.selectedLanNodeId) {
      lanMove.onclick = () => { this.engine.moveLanNode(this.selectedLanNodeId!); this.renderUi(); };
    }
    const lanProbe = panel.querySelector<HTMLButtonElement>("#btn-lan-probe");
    if (lanProbe && this.selectedLanNodeId) {
      lanProbe.onclick = () => this.engine.startTask("lan_probe", this.selectedLanNodeId!);
    }
    const lanSpoof = panel.querySelector<HTMLButtonElement>("#btn-lan-spoof");
    if (lanSpoof && this.selectedLanNodeId) {
      lanSpoof.onclick = () => this.engine.startTask("lan_spoof", this.selectedLanNodeId!);
    }
    const lanForce = panel.querySelector<HTMLButtonElement>("#btn-lan-force");
    if (lanForce && this.selectedLanNodeId) {
      lanForce.onclick = () => this.engine.startTask("lan_force", this.selectedLanNodeId!);
    }

    // Bank handlers
    panel.querySelectorAll<HTMLButtonElement>("[data-bank-login]").forEach((b) => {
      b.onclick = () => { this.engine.loginBankAccount(b.dataset.bankLogin!, b.dataset.bankPw!); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-bank-crack]").forEach((b) => {
      b.onclick = () => this.engine.startTask("password_breaker", b.dataset.bankCrack!);
    });
    const xferBtn = panel.querySelector<HTMLButtonElement>("#btn-bank-xfer");
    if (xferBtn) {
      xferBtn.onclick = () => {
        const amt = Number(panel.querySelector<HTMLInputElement>("#bank-xfer-amt")!.value);
        const s = this.engine.getState();
        this.engine.transferBankFunds(s.player.bankIp, s.player.bankAccountNumber, amt);
        this.renderUi();
      };
    }
    panel.querySelectorAll<HTMLButtonElement>("[data-del-stmt]").forEach((b) => {
      b.onclick = () => {
        const acctNum = this.engine.getState().connection.authenticatedBankAccount;
        if (acctNum) this.engine.deleteBankStatement(acctNum, b.dataset.delStmt!);
        this.renderUi();
      };
    });

    // Gov DB handlers
    panel.querySelectorAll<HTMLButtonElement>("[data-set-gpa]").forEach((b) => {
      b.onclick = () => { this.engine.updateAcademicRecord(b.dataset.setGpa!, "4.0"); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-clear-crime]").forEach((b) => {
      b.onclick = () => { this.engine.updateCriminalRecord(b.dataset.clearCrime!, "clear"); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-frame-crime]").forEach((b) => {
      b.onclick = () => { this.engine.updateCriminalRecord(b.dataset.frameCrime!, "add_crime"); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-set-emp]").forEach((b) => {
      b.onclick = () => { this.engine.updateSocialRecord(b.dataset.setEmp!, "Meridian Logistics"); this.renderUi(); };
    });

    // File & Log handlers
    panel.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
      b.onclick = () => this.engine.startTask("file_copier", b.dataset.copy!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => {
      b.onclick = () => this.engine.startTask("file_deleter", b.dataset.del!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-wipe-log]").forEach((b) => {
      b.onclick = () => this.engine.startTask("log_deleter", b.dataset.wipeLog!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-undel-log]").forEach((b) => {
      b.onclick = () => this.engine.startTask("log_undeleter", b.dataset.undelLog!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-mod-log]").forEach((b) => {
      b.onclick = () => this.engine.startTask("log_modifier", b.dataset.modLog!, "198.51.100.77");
    });
  }

  private renderLocalDashboard(panel: HTMLElement): void {
    const s = this.engine.getState();
    panel.innerHTML = `
      <h2>Local Gateway Dashboard</h2>
      <div class="tabs">
        ${(["missions", "shop", "gateway", "news", "inbox"] as const)
          .map(
            (t) =>
              `<button data-tab="${t}" class="${this.activeTab === t ? "active" : ""}">${t.toUpperCase()}</button>`
          )
          .join("")}
      </div>
      <div class="list" id="local-tab-body"></div>
    `;

    panel.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
      b.onclick = () => {
        this.activeTab = b.dataset.tab as LocalTab;
        this.renderRightPanel();
      };
    });

    const body = panel.querySelector<HTMLElement>("#local-tab-body")!;
    if (this.activeTab === "missions") {
      body.innerHTML = s.missions
        .map(
          (m) => `
          <div class="row" style="align-items:flex-start;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;width:100%;">
              <strong>${m.title}</strong>
              <span>${m.payment.toLocaleString()}c</span>
            </div>
            <div class="muted">${m.description}</div>
            <div class="controls">
              ${
                m.completed
                  ? `<span class="pill" style="color:var(--success)">COMPLETED</span>`
                  : m.accepted
                    ? `<button data-complete="${m.id}" class="primary">Submit &amp; Claim</button>`
                    : `<button data-accept="${m.id}">Accept Contract</button>`
              }
            </div>
          </div>`
        )
        .join("");

      body.querySelectorAll<HTMLButtonElement>("[data-accept]").forEach((b) => {
        b.onclick = () => { this.engine.acceptMission(b.dataset.accept!); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-complete]").forEach((b) => {
        b.onclick = () => { this.engine.completeMission(b.dataset.complete!); this.renderUi(); };
      });
    } else if (this.activeTab === "shop") {
      const swHtml = SOFTWARE_CATALOG.filter((sw) => sw.cost > 0)
        .map((sw) => {
          const owned = s.player.gateway.software.some((x) => x.id === sw.id && x.version === sw.version);
          return `
            <div class="row">
              <div><strong>${sw.name} v${sw.version}.0</strong> <span class="muted">(${sw.sizeGq} Gq) — ${sw.description}</span></div>
              <button data-buy-sw="${sw.id}" data-ver="${sw.version}" ${owned || s.player.credits < sw.cost ? "disabled" : ""}>${owned ? "Owned" : `${sw.cost}c`}</button>
            </div>`;
        })
        .join("");
      const cpuHtml = CPU_CATALOG.map(
        (c) => `
        <div class="row">
          <div><strong>${c.name}</strong> <span class="muted">Adds/upgrades gateway CPU</span></div>
          <button data-buy-cpu="${c.id}" ${s.player.credits < c.cost ? "disabled" : ""}>${c.cost}c</button>
        </div>`
      ).join("");
      const gwHtml = GATEWAY_CATALOG.filter((g) => g.cost > 0)
        .map(
          (g) => `
          <div class="row">
            <div><strong>${g.name}</strong> <span class="muted">${g.maxCpus} CPUs, ${g.maxMemoryGq} Gq RAM</span></div>
            <button data-buy-gw="${g.id}" ${s.player.gateway.specId === g.id || s.player.credits < g.cost ? "disabled" : ""}>${g.cost}c</button>
          </div>`
        )
        .join("");

      body.innerHTML = swHtml + cpuHtml + gwHtml;
      body.querySelectorAll<HTMLButtonElement>("[data-buy-sw]").forEach((b) => {
        b.onclick = () => {
          this.engine.buySoftware(b.dataset.buySw as SoftwareId, Number(b.dataset.ver));
          this.renderUi();
        };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-cpu]").forEach((b) => {
        b.onclick = () => { this.engine.buyCpu(b.dataset.buyCpu!); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-gw]").forEach((b) => {
        b.onclick = () => { this.engine.upgradeGateway(b.dataset.buyGw!); this.renderUi(); };
      });
    } else if (this.activeTab === "gateway") {
      body.innerHTML = `
        <div class="row">
          <span>Import Save JSON</span>
          <input id="import-save" type="file" accept="application/json" />
        </div>
        <div class="muted">Local Files (${s.player.gateway.files.length})</div>
        ${
          s.player.gateway.files.length === 0
            ? `<div class="muted">No downloaded files in memory.</div>`
            : s.player.gateway.files
                .map(
                  (f) => `
                  <div class="row">
                    <span>${f.name} <span class="muted">(${f.sizeGq} Gq${f.encryptedLevel > 0 ? `, Encrypted L${f.encryptedLevel}` : ", Plaintext"})</span></span>
                    ${f.encryptedLevel > 0 ? `<button data-decrypt="${f.id}" class="primary">Decrypt</button>` : ""}
                  </div>`
                )
                .join("")
        }
        <div class="muted">Installed Software (${s.player.gateway.software.length})</div>
        ${s.player.gateway.software
          .map((sw) => `<div class="row"><span>${sw.id.replace(/_/g, " ")} v${sw.version}.0</span><span class="muted">${sw.sizeGq} Gq</span></div>`)
          .join("")}
      `;
      body.querySelectorAll<HTMLButtonElement>("[data-decrypt]").forEach((b) => {
        b.onclick = () => this.engine.startTask("decrypter", b.dataset.decrypt!);
      });
      const fileInput = body.querySelector<HTMLInputElement>("#import-save");
      if (fileInput) {
        fileInput.onchange = () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          void file.text().then((txt) => {
            try {
              this.engine.loadState(deserializeState(txt));
              this.logFeed("Imported save file successfully.");
              this.renderUi();
            } catch {
              this.logFeed("Invalid save JSON.");
              this.renderFeed();
            }
          });
        };
      }
    } else if (this.activeTab === "news") {
      const st = s.story;
      body.innerHTML = `
        <div class="row" style="flex-direction:column;align-items:flex-start;">
          <strong>Storyline: ARC vs. Arunmor (${st.stage.replace(/_/g, " ").toUpperCase()})</strong>
          <div class="muted">Revelation Infected: ${st.revelationCount}/${REVELATION_WIN_THRESHOLD} · Faith Protected: ${st.faithCount}/${FAITH_WIN_THRESHOLD}</div>
          ${
            st.stage === "dead_agent_email"
              ? `<div class="controls">
                   <button id="btn-join-arc" class="danger">Side with ARC (Revelation)</button>
                   <button id="btn-join-arunmor" class="primary">Side with Arunmor (Faith)</button>
                 </div>`
              : st.stage === "dormant"
                ? `<div class="muted">Complete contracts to reach Novice rating (6+ score) to trigger the storyline.</div>`
                : ""
          }
        </div>
        ${s.news
          .map(
            (n) => `
            <div class="row" style="flex-direction:column;align-items:flex-start;">
              <strong>${n.headline}</strong>
              <div class="muted">${formatGameDate(n.timestampMs)} — ${n.body}</div>
            </div>`
          )
          .join("")}
      `;
      const arcBtn = body.querySelector<HTMLButtonElement>("#btn-join-arc");
      if (arcBtn) arcBtn.onclick = () => { this.engine.joinStoryFaction("arc"); this.renderUi(); };
      const arunBtn = body.querySelector<HTMLButtonElement>("#btn-join-arunmor");
      if (arunBtn) arunBtn.onclick = () => { this.engine.joinStoryFaction("arunmor"); this.renderUi(); };
    } else {
      body.innerHTML = s.emails
        .map(
          (e) => `
          <div class="row" style="flex-direction:column;align-items:flex-start;">
            <div><strong>${e.subject}</strong> <span class="muted">from ${e.from}</span></div>
            <div class="muted" style="white-space:pre-wrap">${e.body}</div>
          </div>`
        )
        .join("");
    }
  }

  private renderTasks(): void {
    const s = this.engine.getState();
    const el = this.root.querySelector<HTMLElement>("#task-list")!;
    if (s.tasks.length === 0) {
      el.innerHTML = `<div class="muted">No active CPU tasks. Connect to a server or launch Trace Tracker.</div>`;
      return;
    }
    el.innerHTML = s.tasks
      .map(
        (t) => `
        <div class="row" style="flex-direction:column;align-items:stretch;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span><strong>${t.kind.replace(/_/g, " ")}</strong> v${t.version}.0 · ${t.statusText}</span>
            <div class="controls">
              <span class="muted">${t.allocatedGhz.toFixed(1)} GHz</span>
              <button data-w-down="${t.id}">-</button>
              <button data-w-up="${t.id}">+</button>
              <button data-stop="${t.id}" class="danger">×</button>
            </div>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${t.kind === "trace_tracker" && s.connection.traceActive ? "danger" : ""}" style="width:${Math.round(t.progress * 100)}%"></div>
          </div>
        </div>`
      )
      .join("");

    el.querySelectorAll<HTMLButtonElement>("[data-stop]").forEach((b) => {
      b.onclick = () => { this.engine.stopTask(b.dataset.stop!); this.renderTasks(); };
    });
    el.querySelectorAll<HTMLButtonElement>("[data-w-down]").forEach((b) => {
      b.onclick = () => {
        const task = this.engine.getState().tasks.find((x) => x.id === b.dataset.wDown);
        if (task) this.engine.setTaskWeight(task.id, task.cpuWeight - 1);
        this.renderTasks();
      };
    });
    el.querySelectorAll<HTMLButtonElement>("[data-w-up]").forEach((b) => {
      b.onclick = () => {
        const task = this.engine.getState().tasks.find((x) => x.id === b.dataset.wUp);
        if (task) this.engine.setTaskWeight(task.id, task.cpuWeight + 1);
        this.renderTasks();
      };
    });
  }

  private renderFeed(): void {
    const el = this.root.querySelector<HTMLElement>("#event-feed")!;
    el.innerHTML = this.feed.map((line) => `<div class="muted">${line}</div>`).join("");
  }
}
