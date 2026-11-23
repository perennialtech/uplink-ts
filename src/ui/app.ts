import {
  clearBrowserSave,
  CPU_CATALOG,
  createInitialWorld,
  formatGameDate,
  formatSeconds,
  GATEWAY_CATALOG,
  getUplinkRatingName,
  loadFromBrowser,
  saveToBrowser,
  SOFTWARE_CATALOG,
  UplinkEngine,
  type GameEvent,
  type SoftwareId,
} from "../engine";
import { SoundSynth } from "./audio";
import { WorldMapRenderer } from "./worldMap";

type LocalTab = "missions" | "shop" | "gateway" | "inbox";

export class UplinkApp {
  private root: HTMLElement;
  private engine: UplinkEngine;
  private synth = new SoundSynth();
  private mapRenderer: WorldMapRenderer | null = null;
  private activeTab: LocalTab = "missions";
  private feed: string[] = [];
  private lastFrameMs = performance.now();
  private uiAccum = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const saved = loadFromBrowser();
    this.engine = new UplinkEngine(saved ?? createInitialWorld("Agent"));
    this.engine.events.subscribe((ev) => this.onGameEvent(ev));
    this.logFeed("Gateway online. Click nodes on the map to plot a bounce route.");
    this.mountSkeleton();
    this.renderUi();
    requestAnimationFrame((t) => this.loop(t));
  }

  private onGameEvent(ev: GameEvent): void {
    this.synth.handleEvent(ev);
    switch (ev.type) {
      case "connection.opened":
        this.logFeed(`Connected to ${ev.targetIp} via ${ev.hops} hop(s).`);
        break;
      case "connection.closed":
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
      case "task.completed":
        this.logFeed(ev.summary);
        break;
      case "mission.completed":
        this.logFeed(`Contract complete! +${ev.payment.toLocaleString()}c`);
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
    if (this.feed.length > 30) this.feed.length = 30;
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
            <div class="list" id="server-links" style="max-height:150px"></div>
          </section>
          <section class="card" id="right-panel"></section>
        </main>
        <footer class="bottom-dock">
          <section class="card">
            <h2>CPU Task Manager</h2>
            <div class="list" id="task-list" style="max-height:160px"></div>
          </section>
          <section class="card">
            <h2>Event Log</h2>
            <div class="list" id="event-feed" style="max-height:160px"></div>
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

    this.uiAccum += dt;
    if (this.uiAccum >= 0.15) {
      this.uiAccum = 0;
      this.renderDynamicPanels();
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private renderDynamicPanels(): void {
    this.renderTopbar();
    this.renderTasks();
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
        <span class="pill">${getUplinkRatingName(s.player.uplinkScore)}</span>
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
      saveToBrowser(this.engine.getState());
      this.logFeed("Game saved to browser storage.");
      this.renderFeed();
    };
    topbar.querySelector<HTMLButtonElement>("#btn-reset")!.onclick = () => {
      clearBrowserSave();
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
      clearBrowserSave();
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
            <span class="muted">${srv.ip} · ${srv.playerAccess}</span>
          </div>
          <button data-add-ip="${srv.ip}" ${s.connection.connected || s.connection.route.includes(srv.ip) ? "disabled" : ""}>+ Bounce</button>
        </div>
      `
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

  private renderRemoteServer(panel: HTMLElement, target: ReturnType<UplinkEngine["getTargetServer"]> & object): void {
    const s = this.engine.getState();
    const auth = s.connection.authenticatedAs;

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
        <button id="btn-tracker">Run Trace Tracker</button>
        ${auth === "none" ? `<button id="btn-crack" class="primary">Run Password Breaker (admin)</button>` : ""}
        ${target.security.some((x) => x.kind === "proxy" && x.enabled) ? `<button id="btn-proxy-dis">Disable Proxy</button><button id="btn-proxy-byp">Bypass Proxy</button>` : ""}
        ${target.security.some((x) => x.kind === "monitor" && x.enabled) ? `<button id="btn-mon-byp">Bypass Monitor</button>` : ""}
        ${target.lanNodes ? `<button id="btn-lan-scan">Run LAN Scan</button>` : ""}
      </div>

      ${
        auth === "none"
          ? `<div class="row">
               <div>Manual Admin Login (InterNIC is <code>admin</code>)</div>
               <div class="controls">
                 <input id="manual-pw" type="password" placeholder="password" style="background:#050912;color:#fff;border:1px solid #1e3252;padding:4px 6px;" />
                 <button id="btn-manual-login">Login</button>
               </div>
             </div>`
          : ""
      }

      ${
        auth !== "none"
          ? `
        <div><strong>Files (${target.files.length})</strong></div>
        <div class="list" style="max-height:130px">
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
        <div class="list" style="max-height:140px">
          ${
            target.logs.length === 0
              ? `<div class="muted">No logs recorded.</div>`
              : target.logs
                  .slice(0, 12)
                  .map(
                    (l) => `
                <div class="row">
                  <div class="muted">${formatGameDate(l.timestampMs).slice(11)} · ${l.detail}</div>
                  ${auth === "admin" ? `<button data-wipe-log="${l.id}">Wipe</button>` : ""}
                </div>`
                  )
                  .join("")
          }
        </div>
      `
          : `<div class="muted">Authenticate or run Password Breaker to access files and logs.</div>`
      }
    `;

    panel.querySelector<HTMLButtonElement>("#btn-tracker")!.onclick = () => this.engine.startTask("trace_tracker");
    const crackBtn = panel.querySelector<HTMLButtonElement>("#btn-crack");
    if (crackBtn) crackBtn.onclick = () => this.engine.startTask("password_breaker", "admin");
    const proxyDis = panel.querySelector<HTMLButtonElement>("#btn-proxy-dis");
    if (proxyDis) proxyDis.onclick = () => this.engine.startTask("proxy_disable");
    const proxyByp = panel.querySelector<HTMLButtonElement>("#btn-proxy-byp");
    if (proxyByp) proxyByp.onclick = () => this.engine.startTask("proxy_bypass");
    const monByp = panel.querySelector<HTMLButtonElement>("#btn-mon-byp");
    if (monByp) monByp.onclick = () => this.engine.startTask("monitor_bypass");
    const lanScan = panel.querySelector<HTMLButtonElement>("#btn-lan-scan");
    if (lanScan) lanScan.onclick = () => this.engine.startTask("lan_scan");

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

    panel.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
      b.onclick = () => this.engine.startTask("file_copier", b.dataset.copy!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => {
      b.onclick = () => this.engine.startTask("file_deleter", b.dataset.del!);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-wipe-log]").forEach((b) => {
      b.onclick = () => this.engine.startTask("log_deleter", b.dataset.wipeLog!);
    });
  }

  private renderLocalDashboard(panel: HTMLElement): void {
    const s = this.engine.getState();
    panel.innerHTML = `
      <h2>Local Gateway Dashboard</h2>
      <div class="tabs">
        ${(["missions", "shop", "gateway", "inbox"] as const)
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
        <div class="muted">Installed Software (${s.player.gateway.software.length})</div>
        ${s.player.gateway.software
          .map((sw) => `<div class="row"><span>${sw.id.replace(/_/g, " ")} v${sw.version}.0</span><span class="muted">${sw.sizeGq} Gq</span></div>`)
          .join("")}
        <div class="muted">Local Files (${s.player.gateway.files.length})</div>
        ${
          s.player.gateway.files.length === 0
            ? `<div class="muted">No stolen or downloaded files in memory.</div>`
            : s.player.gateway.files
                .map((f) => `<div class="row"><span>${f.name}</span><span class="muted">${f.sizeGq} Gq</span></div>`)
                .join("")
        }
      `;
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
