import {
  clearSlot,
  CPU_CATALOG,
  createInitialWorld,
  deserializeState,
  FAITH_WIN_THRESHOLD,
  formatGameDate,
  formatSeconds,
  GATEWAY_CATALOG,
  GATEWAY_SECURITY_CATALOG,
  getNeuromancerRatingName,
  getUplinkRatingName,
  isOnLanMainServer,
  loadFromSlot,
  MEMORY_CATALOG,
  MODEM_CATALOG,
  PLAYER_DEFAULTS,
  REVELATION_WIN_THRESHOLD,
  saveToSlot,
  serializeState,
  SOFTWARE_CATALOG,
  UplinkEngine,
  type GameEvent,
  type GatewaySecurityDevice,
  type ServerNode,
  type SoftwareId,
} from "../engine";
import { SoundSynth } from "./audio";
import { findClickedLanNode, renderLanCanvas } from "./lanView";
import { WorldMapRenderer } from "./worldMap";

type LocalTab = "missions" | "market" | "gateway" | "portfolio" | "story" | "inbox";
type MarketFilter = "software" | "hud_lan" | "hardware" | "gateways";
type RemoteTab = "overview" | "files" | "console";

export class UplinkApp {
  private root: HTMLElement;
  private engine: UplinkEngine;
  private synth = new SoundSynth();
  private mapRenderer: WorldMapRenderer | null = null;
  private activeTab: LocalTab = "missions";
  private marketFilter: MarketFilter = "software";
  private remoteTab: RemoteTab = "overview";
  private selectedLanNodeId: string | null = null;
  private serverFilter = "";
  private feed: string[] = [];
  private lastFrameMs = performance.now();
  private uiAccum = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.engine = new UplinkEngine(createInitialWorld("Agent"));
    this.engine.events.subscribe((ev) => this.onGameEvent(ev));
    this.logFeed("Gateway online. Select nodes on the world map to build a bounce route.");
    this.mountSkeleton();
    this.renderUi();

    void loadFromSlot("primary").then((saved) => {
      if (saved) {
        this.engine.loadState(saved);
        this.logFeed("Restored saved agent profile from browser storage.");
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
        this.remoteTab = "overview";
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
        this.logFeed(`Active trace started (~${Math.ceil(ev.totalSeconds)}s remaining).`);
        break;
      case "trace.hop":
        this.logFeed(`Trace reached ${ev.hopIp} (${ev.hopsRemaining} hop(s) left).`);
        break;
      case "lan.sysadmin_alert":
        this.logFeed("LAN Sysadmin alerted and tracking your node.");
        break;
      case "lan.caught":
        this.logFeed("LAN Sysadmin intercepted your connection.");
        break;
      case "task.completed":
        this.logFeed(ev.summary);
        break;
      case "mission.completed":
        this.logFeed(
          ev.payment >= 0
            ? `Contract verified. +${ev.payment.toLocaleString()}c wired.`
            : `Fine settled (${Math.abs(ev.payment).toLocaleString()}c).`
        );
        break;
      case "story.updated":
        this.logFeed(`Newsflash: ${ev.headline}`);
        break;
      case "gateway.proximity":
        this.logFeed(ev.reason);
        break;
      case "gateway.nuked":
        this.logFeed(`Gateway self-destructed. Replacement chassis #${ev.newGatewayId} online.`);
        break;
      case "player.disavowed":
        this.logFeed(`Disavowed: ${ev.reason}`);
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
    if (this.feed.length > 40) this.feed.length = 40;
  }

  private mountSkeleton(): void {
    this.root.innerHTML = `
      <div class="shell">
        <header class="topbar" id="topbar"></header>
        <div id="alert-slot"></div>
        <main class="workspace">
          <section class="bay">
            <div class="bay-header">
              <h2 class="bay-title">Global bounce map</h2>
              <span class="bay-meta" id="map-meta">Click nodes to append hops</span>
            </div>
            <div class="map-frame">
              <canvas id="world-map" width="1000" height="500"></canvas>
            </div>
            <div class="controls" id="route-controls"></div>
            <div class="controls">
              <input id="server-search" type="text" placeholder="Filter servers or enter IP to lookup..." style="flex:1" />
              <button id="btn-ip-lookup">Lookup IP</button>
            </div>
            <div class="list" id="server-links" style="max-height:175px"></div>
          </section>
          <section class="bay" id="right-panel"></section>
        </main>
        <footer class="bottom-dock">
          <section class="bay">
            <div class="bay-header">
              <h2 class="bay-title">CPU task scheduler</h2>
              <span class="bay-meta" id="cpu-meta"></span>
            </div>
            <div class="list" id="task-list" style="max-height:165px"></div>
          </section>
          <section class="bay">
            <div class="bay-header">
              <h2 class="bay-title">System telemetry</h2>
              <span class="bay-meta">Live event stream</span>
            </div>
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

    const searchInput = this.root.querySelector<HTMLInputElement>("#server-search")!;
    searchInput.oninput = () => {
      this.serverFilter = searchInput.value.trim().toLowerCase();
      this.renderServerLinks();
    };
    this.root.querySelector<HTMLButtonElement>("#btn-ip-lookup")!.onclick = () => {
      const val = searchInput.value.trim();
      if (!val) return;
      if (this.engine.getHighestSoftwareVersion("ip_lookup") > 0) {
        this.engine.startTask("ip_lookup", val);
      } else {
        const srv = this.engine.discoverServerByIp(val);
        if (!srv) {
          this.logFeed(`No host found at ${val}.`);
          this.renderFeed();
        }
      }
      this.renderUi();
    };
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
    this.renderAlertBanner();
    this.renderRouteControls();
    this.renderServerLinks();
    this.renderRightPanel();
    this.renderTasks();
    this.renderFeed();
  }

  private renderTopbar(): void {
    const s = this.engine.getState();
    const topbar = this.root.querySelector<HTMLElement>("#topbar")!;
    const usedMem = this.engine.getUsedMemoryGq();
    const totalCpu = this.engine.getTotalCpuGhz();
    const effBw = this.engine.getEffectiveBandwidthGbps();

    topbar.innerHTML = `
      <div class="brand-group">
        <span class="brand">Uplink Gateway OS</span>
        <span class="brand-sub">${s.player.gateway.locationCity} #${s.player.gateway.gatewayIdNumber}</span>
      </div>
      <div class="telemetry-strip">
        <div class="metric">
          <span class="metric-label">World clock</span>
          <span class="metric-value">${formatGameDate(s.timeMs)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Balance</span>
          <span class="metric-value">${s.player.credits.toLocaleString()}c</span>
        </div>
        <div class="metric">
          <span class="metric-label">Uplink rating</span>
          <span class="metric-value">${getUplinkRatingName(s.player.uplinkScore)} (${s.player.uplinkScore})</span>
        </div>
        <div class="metric">
          <span class="metric-label">Neuromancer</span>
          <span class="metric-value">${getNeuromancerRatingName(s.player.neuromancerScore)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Hardware</span>
          <span class="metric-value">${totalCpu} GHz / ${usedMem}/${s.player.gateway.memoryTotalGq} Gq / ${effBw} Gq/s</span>
        </div>
      </div>
      <div class="controls">
        <div class="speed-group">
          ${([0, 1, 2, 4, 60] as const)
            .map(
              (spd) =>
                `<button data-speed="${spd}" class="${s.timeScale === spd ? "primary" : ""}">${spd === 0 ? "Pause" : `${spd}x`}</button>`
            )
            .join("")}
        </div>
        <button id="btn-save">Save</button>
        <button id="btn-export">Export</button>
        <button id="btn-reset" class="danger">New world</button>
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
        this.logFeed("Saved agent state to IndexedDB.");
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
      this.logFeed("Provisioned fresh procedural world.");
      this.renderUi();
    };
  }

  private renderAlertBanner(): void {
    const s = this.engine.getState();
    const slot = this.root.querySelector<HTMLElement>("#alert-slot")!;
    if (s.player.disavowed) {
      slot.innerHTML = `
        <div class="banner-danger">
          <div><strong>Agent disavowed:</strong> ${s.player.disavowedReason ?? "Gateway seized by federal agents."}</div>
          <button id="btn-restart" class="primary">Start new agent</button>
        </div>
      `;
      slot.querySelector<HTMLButtonElement>("#btn-restart")!.onclick = () => {
        void clearSlot("primary");
        this.engine.loadState(createInitialWorld("Agent", Math.floor(Math.random() * 1_000_000)));
        this.renderUi();
      };
      return;
    }

    if (s.player.gateway.proximityAlert > 0) {
      const canNuke = this.engine.hasSecurityDevice("self_destruct");
      slot.innerHTML = `
        <div class="banner-warn">
          <div><strong>Motion sensor alert:</strong> Federal agents approaching physical gateway. ${canNuke ? "Detonate self-destruct to destroy evidence and survive." : "Install Self Destruct hardware in Market to survive raids."}</div>
          ${canNuke ? `<button id="btn-banner-nuke" class="danger">Nuke gateway</button>` : ""}
        </div>
      `;
      const nukeBtn = slot.querySelector<HTMLButtonElement>("#btn-banner-nuke");
      if (nukeBtn) nukeBtn.onclick = () => { this.engine.nukeGateway(); this.renderUi(); };
      return;
    }

    slot.innerHTML = "";
  }

  private renderRouteControls(): void {
    const s = this.engine.getState();
    const rc = this.root.querySelector<HTMLElement>("#route-controls")!;
    const mapMeta = this.root.querySelector<HTMLElement>("#map-meta")!;
    const hops = Math.max(0, s.connection.route.length - 1);
    const estTrace =
      hops > 0 ? this.engine.computeTotalTraceSeconds(s.connection.route) : Number.POSITIVE_INFINITY;

    mapMeta.textContent = s.connection.connected
      ? `Connected (${hops} hops) | Est. trace: ${Number.isFinite(estTrace) ? formatSeconds(estTrace) : "None"}`
      : `Planned route: ${hops} hop(s) | Est. trace: ${Number.isFinite(estTrace) ? formatSeconds(estTrace) : "None"}`;

    rc.innerHTML = `
      ${
        s.connection.connected
          ? `<button id="btn-disconnect" class="danger">Disconnect</button>`
          : `<button id="btn-connect" class="primary" ${hops === 0 ? "disabled" : ""}>Connect (${hops} hops)</button>`
      }
      <button id="btn-undo" ${s.connection.connected || hops === 0 ? "disabled" : ""}>Undo hop</button>
      <button id="btn-clear" ${s.connection.connected || hops === 0 ? "disabled" : ""}>Clear</button>
      <button id="btn-save-route" ${hops === 0 ? "disabled" : ""}>Save route</button>
      <button id="btn-load-route" ${s.connection.connected ? "disabled" : ""}>Load route</button>
    `;

    const connBtn = rc.querySelector<HTMLButtonElement>("#btn-connect");
    if (connBtn) connBtn.onclick = () => { this.engine.connect(); this.renderUi(); };
    const discBtn = rc.querySelector<HTMLButtonElement>("#btn-disconnect");
    if (discBtn) discBtn.onclick = () => { this.engine.disconnect(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-undo")!.onclick = () => { this.engine.removeLastBounceNode(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-clear")!.onclick = () => { this.engine.clearRoute(); this.renderUi(); };
    rc.querySelector<HTMLButtonElement>("#btn-save-route")!.onclick = () => {
      this.engine.saveBounceRoute();
      this.logFeed("Saved bounce route preset.");
      this.renderFeed();
    };
    rc.querySelector<HTMLButtonElement>("#btn-load-route")!.onclick = () => { this.engine.loadBounceRoute(); this.renderUi(); };
  }

  private renderServerLinks(): void {
    const s = this.engine.getState();
    const links = this.root.querySelector<HTMLElement>("#server-links")!;
    const discovered = Object.values(s.servers).filter((srv) => {
      if (!srv.discovered) return false;
      if (!this.serverFilter) return true;
      return (
        srv.name.toLowerCase().includes(this.serverFilter) ||
        srv.ip.toLowerCase().includes(this.serverFilter) ||
        srv.companyName.toLowerCase().includes(this.serverFilter)
      );
    });

    links.innerHTML = discovered
      .map(
        (srv) => `
        <div class="row">
          <div>
            <strong>${srv.name}</strong>
            <div class="muted mono">${srv.ip} | ${srv.destroyed ? "Offline (destroyed)" : `Access: ${srv.playerAccess}`}${srv.revelationInfected ? " | Revelation" : ""}${srv.faithProtected ? " | Faith" : ""}</div>
          </div>
          <button data-add-ip="${srv.ip}" ${srv.destroyed || s.connection.connected || s.connection.route.includes(srv.ip) ? "disabled" : ""}>Add hop</button>
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
      <div class="bay-header">
        <h2 class="bay-title">${target.name}</h2>
        <span class="bay-meta">${target.ip} | Access: ${auth}</span>
      </div>
      <div class="controls">
        ${target.security
          .map(
            (sec) =>
              `<span class="tag ${sec.bypassed ? "tag-ok" : sec.enabled ? "tag-warn" : "tag-info"}">${sec.kind} L${sec.level}: ${sec.bypassed ? "bypassed" : sec.enabled ? "active" : "disabled"}</span>`
          )
          .join("")}
        ${target.requiresCypher ? `<span class="tag ${s.connection.cypherPassed ? "tag-ok" : "tag-warn"}">Cypher L${target.cypherLevel ?? 1}: ${s.connection.cypherPassed ? "cracked" : "locked"}</span>` : ""}
        ${target.requiresVoiceAuth ? `<span class="tag ${s.connection.voicePassed ? "tag-ok" : "tag-warn"}">Voice auth: ${s.connection.voicePassed ? "verified" : target.voiceAdminName ?? "required"}</span>` : ""}
      </div>
      <div class="controls">
        <button id="btn-tracker">Trace Tracker</button>
        <button id="btn-ip-probe">IP Probe</button>
        ${target.requiresCypher && !s.connection.cypherPassed ? `<button id="btn-decypher" class="primary">Run Decypher</button>` : ""}
        ${target.requiresVoiceAuth && !s.connection.voicePassed ? `<button id="btn-voice" class="primary">Run Voice Analyser</button>` : ""}
        ${auth === "none" && lanReady && target.kind !== "bank" && target.kind !== "protovision" ? `<button id="btn-crack" class="primary">Password Breaker</button><button id="btn-dict">Dictionary Hacker</button>` : ""}
        ${target.security.some((x) => x.kind === "proxy" && x.enabled) ? `<button id="btn-proxy-dis">Disable Proxy</button><button id="btn-proxy-byp">Bypass Proxy</button>` : ""}
        ${target.security.some((x) => x.kind === "firewall" && x.enabled) ? `<button id="btn-fw-dis">Disable Firewall</button><button id="btn-fw-byp">Bypass Firewall</button>` : ""}
        ${target.security.some((x) => x.kind === "monitor" && x.enabled) ? `<button id="btn-mon-byp">Bypass Monitor</button>` : ""}
        ${auth === "admin" && hasRev ? `<button id="btn-deploy-rev" class="danger">Deploy Revelation</button>` : ""}
        ${auth === "admin" && hasFaith ? `<button id="btn-deploy-faith" class="primary">Deploy Faith</button>` : ""}
      </div>

      <div class="tabs">
        <button data-rtab="overview" class="${this.remoteTab === "overview" ? "active" : ""}">Host services</button>
        <button data-rtab="files" class="${this.remoteTab === "files" ? "active" : ""}">Files & logs (${target.files.length}/${target.logs.length})</button>
        <button data-rtab="console" class="${this.remoteTab === "console" ? "active" : ""}">Admin console</button>
      </div>

      <div id="remote-body" style="display:flex;flex-direction:column;gap:8px;">
        ${
          this.remoteTab === "console"
            ? this.buildConsoleHtml(target, auth)
            : this.remoteTab === "files"
              ? this.buildFilesLogsHtml(target, auth, lanReady)
              : this.buildRemoteOverviewHtml(target, auth, lanReady)
        }
      </div>
    `;

    this.bindRemoteHandlers(panel, target);
  }

  private buildRemoteOverviewHtml(target: ServerNode, auth: string, lanReady: boolean): string {
    const parts: string[] = [];

    if (target.kind === "protovision") {
      parts.push(`
        <div class="console-box">
          <div class="console-output">GREETINGS PROFESSOR FALKEN.

SHALL WE PLAY A GAME?

  1. Falken's Maze
  2. Chess
  3. Global Thermonuclear War

A strange game. The only winning move is not to play.</div>
        </div>
      `);
      return parts.join("");
    }

    if (target.lanNodes) parts.push(this.buildLanHtml(target));
    if (target.kind === "bank") parts.push(this.buildBankHtml(target));
    if (target.kind === "stock_market") parts.push(this.buildStockMarketHtml());
    if (target.kind === "internic") parts.push(this.buildInternicDirectoryHtml());
    if (
      (target.kind === "database_academic" ||
        target.kind === "database_criminal" ||
        target.kind === "database_social" ||
        target.kind === "database_medical") &&
      auth !== "none"
    ) {
      parts.push(this.buildGovDbHtml(target));
    }

    if (auth === "none" && lanReady && target.kind !== "bank") {
      parts.push(`
        <div class="row">
          <div>
            <strong>Admin authentication</strong>
            <div class="muted">Enter password manually or launch Password Breaker above.</div>
          </div>
          <div class="controls">
            <input id="manual-pw" type="password" placeholder="password" />
            <button id="btn-manual-login" class="primary">Sign in</button>
          </div>
        </div>
      `);
    }

    if (parts.length === 0) {
      parts.push(`
        <div class="row">
          <div>
            <strong>${target.companyName}</strong>
            <div class="muted">Authenticated session active. Open Files & logs or Admin console to operate on this host.</div>
          </div>
        </div>
      `);
    }

    return parts.join("");
  }

  private buildInternicDirectoryHtml(): string {
    const allServers = Object.values(this.engine.getState().servers).filter((s) => !s.destroyed);
    return `
      <div class="muted">InterNIC Global Directory (${allServers.length} hosts)</div>
      <div class="list" style="max-height:220px">
        ${allServers
          .map(
            (srv) => `
          <div class="row">
            <div>
              <strong>${srv.name}</strong>
              <div class="muted mono">${srv.ip}</div>
            </div>
            <button data-internic-add="${srv.ip}" ${srv.discovered ? "disabled" : ""}>${srv.discovered ? "In links" : "Add link"}</button>
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  private buildStockMarketHtml(): string {
    const s = this.engine.getState();
    const companies = Object.values(s.companies);
    return `
      <div class="muted">International Stock Market System — Live Equities</div>
      <div class="list" style="max-height:240px">
        ${companies
          .map((c) => {
            const held = s.player.portfolio.find((p) => p.companyId === c.id)?.shares ?? 0;
            const prev = c.shareHistory[c.shareHistory.length - 2] ?? c.currentSharePrice;
            const diff = c.currentSharePrice - prev;
            return `
              <div class="row">
                <div>
                  <strong>${c.name}</strong>
                  <div class="muted mono">${c.currentSharePrice}c (${diff >= 0 ? "+" : ""}${diff}) | Owned: ${held}</div>
                </div>
                <div class="controls">
                  <button data-buy-stock="${c.id}" class="primary">Buy 10</button>
                  <button data-sell-stock="${c.id}" ${held < 10 ? "disabled" : ""}>Sell 10</button>
                </div>
              </div>`;
          })
          .join("")}
      </div>
    `;
  }

  private buildFilesLogsHtml(target: ServerNode, auth: string, lanReady: boolean): string {
    if (auth === "none" || !lanReady) {
      return `<div class="row"><span class="muted">Authenticate as user or admin on the target host to view files and logs.</span></div>`;
    }
    return `
      <div class="muted">Databank files (${target.files.length})</div>
      <div class="list" style="max-height:130px">
        ${
          target.files.length === 0
            ? `<div class="muted">No files stored on this server.</div>`
            : target.files
                .map(
                  (f) => `
              <div class="row">
                <div>
                  <span class="mono">${f.name}</span>
                  <span class="muted">(${f.sizeGq} Gq${f.encryptedLevel > 0 ? `, Encrypted L${f.encryptedLevel}` : ""})</span>
                </div>
                <div class="controls">
                  <button data-copy="${f.id}">Copy</button>
                  <button data-del="${f.id}" class="danger">Delete</button>
                </div>
              </div>`
                )
                .join("")
        }
      </div>
      <div class="muted">Access logs (${target.logs.length})</div>
      <div class="list" style="max-height:150px">
        ${
          target.logs.length === 0
            ? `<div class="muted">No logs recorded.</div>`
            : target.logs
                .slice(0, 15)
                .map(
                  (l) => `
              <div class="row">
                <div class="muted mono">${formatGameDate(l.timestampMs).slice(11)} ${l.detail}</div>
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
    `;
  }

  private buildConsoleHtml(_target: ServerNode, auth: string): string {
    if (auth !== "admin") {
      return `<div class="row"><span class="muted">Admin privileges required to open the Remote Console.</span></div>`;
    }
    const c = this.engine.getState().connection.console;
    return `
      <div class="console-box">
        <div class="console-output" id="console-output">${c.lines.join("\n")}</div>
        <div class="console-input-row">
          <span class="console-prompt">${c.currentDir}:&gt;</span>
          <input id="console-input" type="text" placeholder="help, dir, cd sys, delete, run revelation, shutdown" autocomplete="off" />
          <button id="btn-console-run" class="primary">Execute</button>
        </div>
      </div>
    `;
  }

  private buildLanHtml(target: ServerNode): string {
    const sel = target.lanNodes?.find((n) => n.id === this.selectedLanNodeId);
    const session = this.engine.getState().connection.lanSession;
    const curNode = target.lanNodes?.find((n) => n.id === session?.currentNodeId);
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div class="row-head">
          <strong>LAN topology ${session?.sysadminAlerted ? "(Sysadmin tracking)" : ""}</strong>
          <div class="controls">
            <button id="btn-lan-scan">LAN Scan</button>
            ${sel ? `<button id="btn-lan-move" class="primary">Move to ${sel.label}</button>` : ""}
            ${sel ? `<button id="btn-lan-probe">Probe</button>` : ""}
            ${sel?.kind === "auth_server" ? `<button id="btn-lan-spoof">Spoof</button>` : ""}
            ${sel && !sel.unlocked ? `<button id="btn-lan-force" class="danger">Force lock</button>` : ""}
            ${curNode?.kind === "isolation_bridge" ? `<button id="btn-lan-bridge" class="primary">Flip bridge</button>` : ""}
          </div>
        </div>
        ${
          curNode?.kind === "radio_transmitter"
            ? `<div class="row">
                 <span>Radio Transmitter (${session?.tunedFreqMhz.toFixed(1)} GHz)</span>
                 <div class="controls">
                   <input id="lan-freq-input" type="number" step="0.1" min="140" max="180" value="${session?.tunedFreqMhz.toFixed(1) ?? "162.4"}" style="width:85px" />
                   <button id="btn-lan-tune" class="primary">Tune GHz</button>
                 </div>
               </div>`
            : ""
        }
        <canvas id="lan-canvas" width="560" height="270"></canvas>
      </div>
    `;
  }

  private buildBankHtml(target: ServerNode): string {
    const s = this.engine.getState();
    const acctNum = s.connection.authenticatedBankAccount;
    const acct = target.bankAccounts.find((a) => a.accountNumber === acctNum);
    if (!acct) {
      return `
        <div class="muted">Bank accounts on ${target.name}</div>
        <div class="list" style="max-height:230px">
          ${target.bankAccounts
            .map(
              (a) => `
              <div class="row">
                <div><strong class="mono">#${a.accountNumber}</strong> ${a.ownerName}</div>
                <div class="controls">
                  ${a.accountNumber === s.player.bankAccountNumber ? `<button data-bank-login="${a.accountNumber}" data-bank-pw="${a.password}" class="primary">Open own account</button>` : `<button data-bank-crack="${a.accountNumber}" class="primary">Crack account</button>`}
                </div>
              </div>`
            )
            .join("")}
        </div>
      `;
    }

    const isOwn = acct.accountNumber === s.player.bankAccountNumber;
    return `
      <div class="row">
        <div>
          <strong>Account #${acct.accountNumber} (${acct.ownerName})</strong>
          <div class="muted mono">Loan: ${acct.loan.toLocaleString()}c | Credit rating: ${acct.creditRating}</div>
        </div>
        <strong class="mono">${acct.balance.toLocaleString()}c</strong>
      </div>
      <div class="row">
        <span>Wire to your account (#${s.player.bankAccountNumber})</span>
        <div class="controls">
          <input id="bank-xfer-amt" type="number" value="5000" style="width:90px" />
          <button id="btn-bank-xfer" class="primary">Transfer</button>
        </div>
      </div>
      ${
        isOwn
          ? `<div class="row">
               <span>Credit line (max ${(acct.creditRating * 1000).toLocaleString()}c)</span>
               <div class="controls">
                 <button id="btn-loan-borrow">Borrow 2,000c</button>
                 <button id="btn-loan-repay" ${acct.loan <= 0 ? "disabled" : ""}>Repay 2,000c</button>
               </div>
             </div>`
          : ""
      }
      <div class="muted">Statements (${acct.statements.length})</div>
      <div class="list" style="max-height:130px">
        ${
          acct.statements.length === 0
            ? `<div class="muted">No transfer statements on record.</div>`
            : acct.statements
                .map(
                  (st) => `
                  <div class="row">
                    <div class="muted mono">${st.amount > 0 ? "+" : ""}${st.amount.toLocaleString()}c ${st.note}</div>
                    <button data-del-stmt="${st.id}" class="danger">Delete statement</button>
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
      <div class="muted">${target.name} Registry</div>
      <div class="list" style="max-height:200px">
        ${citizens
          .map((c) => {
            if (target.kind === "database_academic") {
              return `
                <div class="row">
                  <div><strong>${c.fullName}</strong> <span class="muted">${c.degree} (GPA ${c.gpa})</span></div>
                  <button data-set-gpa="${c.id}" class="primary">Set GPA 4.0</button>
                </div>`;
            }
            if (target.kind === "database_criminal") {
              return `
                <div class="row">
                  <div><strong>${c.fullName}</strong> <span class="muted">Records: ${c.criminalHistory.length}${c.arrestWarrant ? " [Warrant]" : ""}</span></div>
                  <div class="controls">
                    <button data-clear-crime="${c.id}">Clear</button>
                    <button data-frame-crime="${c.id}" class="danger">Add crime</button>
                    <button data-warrant-crime="${c.id}" class="danger">Warrant</button>
                  </div>
                </div>`;
            }
            if (target.kind === "database_medical") {
              return `
                <div class="row">
                  <div><strong>${c.fullName}</strong> <span class="muted">${c.bloodType} — ${c.medicalHistory[0] ?? "None"}</span></div>
                  <button data-set-med="${c.id}" class="primary">Clear for Orbital Duty</button>
                </div>`;
            }
            return `
              <div class="row">
                <div><strong>${c.fullName}</strong> <span class="muted">SSN ${c.ssn} (${c.employment})</span></div>
                <button data-set-emp="${c.id}">Set Meridian Logistics</button>
              </div>`;
          })
          .join("")}
      </div>
    `;
  }

  private bindRemoteHandlers(panel: HTMLElement, target: ServerNode): void {
    panel.querySelectorAll<HTMLButtonElement>("[data-rtab]").forEach((b) => {
      b.onclick = () => {
        this.remoteTab = b.dataset.rtab as RemoteTab;
        this.renderRightPanel();
      };
    });

    panel.querySelector<HTMLButtonElement>("#btn-tracker")!.onclick = () => this.engine.startTask("trace_tracker");
    panel.querySelector<HTMLButtonElement>("#btn-ip-probe")!.onclick = () => this.engine.startTask("ip_probe", target.ip);

    const bind = (sel: string, fn: () => void) => {
      const el = panel.querySelector<HTMLButtonElement>(sel);
      if (el) el.onclick = fn;
    };
    bind("#btn-decypher", () => this.engine.startTask("decypher"));
    bind("#btn-voice", () => this.engine.startTask("voice_analyser"));
    bind("#btn-crack", () => this.engine.startTask("password_breaker", "admin"));
    bind("#btn-dict", () => this.engine.startTask("dictionary_hacker", "admin"));
    bind("#btn-proxy-dis", () => this.engine.startTask("proxy_disable"));
    bind("#btn-proxy-byp", () => this.engine.startTask("proxy_bypass"));
    bind("#btn-fw-dis", () => this.engine.startTask("firewall_disable"));
    bind("#btn-fw-byp", () => this.engine.startTask("firewall_bypass"));
    bind("#btn-mon-byp", () => this.engine.startTask("monitor_bypass"));
    bind("#btn-deploy-rev", () => { this.engine.deployStoryPayload("revelation"); this.renderUi(); });
    bind("#btn-deploy-faith", () => { this.engine.deployStoryPayload("faith"); this.renderUi(); });

    bind("#btn-manual-login", () => {
      const pw = panel.querySelector<HTMLInputElement>("#manual-pw")!.value;
      if (!this.engine.login("admin", pw)) {
        this.logFeed("Authentication failed.");
        this.renderFeed();
      }
    });

    // Console handlers
    const consoleInput = panel.querySelector<HTMLInputElement>("#console-input");
    const runConsole = () => {
      if (!consoleInput || !consoleInput.value.trim()) return;
      this.engine.runConsoleCommand(consoleInput.value);
      consoleInput.value = "";
      this.renderUi();
    };
    bind("#btn-console-run", runConsole);
    if (consoleInput) {
      consoleInput.onkeydown = (ev) => {
        if (ev.key === "Enter") runConsole();
      };
    }

    // InterNIC directory
    panel.querySelectorAll<HTMLButtonElement>("[data-internic-add]").forEach((b) => {
      b.onclick = () => {
        this.engine.discoverServerByIp(b.dataset.internicAdd!);
        this.renderUi();
      };
    });

    // Stock Market handlers
    panel.querySelectorAll<HTMLButtonElement>("[data-buy-stock]").forEach((b) => {
      b.onclick = () => { this.engine.buyShares(b.dataset.buyStock!, 10); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-sell-stock]").forEach((b) => {
      b.onclick = () => { this.engine.sellShares(b.dataset.sellStock!, 10); this.renderUi(); };
    });

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
    bind("#btn-lan-scan", () => this.engine.startTask("lan_scan"));
    if (this.selectedLanNodeId) {
      const selId = this.selectedLanNodeId;
      bind("#btn-lan-move", () => { this.engine.moveLanNode(selId); this.renderUi(); });
      bind("#btn-lan-probe", () => this.engine.startTask("lan_probe", selId));
      bind("#btn-lan-spoof", () => this.engine.startTask("lan_spoof", selId));
      bind("#btn-lan-force", () => this.engine.startTask("lan_force", selId));
    }
    bind("#btn-lan-bridge", () => {
      const curId = this.engine.getState().connection.lanSession?.currentNodeId;
      if (curId) this.engine.flipLanIsolationBridge(curId);
      this.renderUi();
    });
    bind("#btn-lan-tune", () => {
      const freq = Number(panel.querySelector<HTMLInputElement>("#lan-freq-input")?.value ?? 162.4);
      this.engine.setLanRadioFrequency(freq);
      this.renderUi();
    });

    // Bank & Loan handlers
    panel.querySelectorAll<HTMLButtonElement>("[data-bank-login]").forEach((b) => {
      b.onclick = () => { this.engine.loginBankAccount(b.dataset.bankLogin!, b.dataset.bankPw!); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-bank-crack]").forEach((b) => {
      b.onclick = () => this.engine.startTask("password_breaker", b.dataset.bankCrack!);
    });
    bind("#btn-bank-xfer", () => {
      const amt = Number(panel.querySelector<HTMLInputElement>("#bank-xfer-amt")!.value);
      const s = this.engine.getState();
      this.engine.transferBankFunds(s.player.bankIp, s.player.bankAccountNumber, amt);
      this.renderUi();
    });
    bind("#btn-loan-borrow", () => { this.engine.requestBankLoan(2000); this.renderUi(); });
    bind("#btn-loan-repay", () => { this.engine.repayBankLoan(2000); this.renderUi(); });
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
    panel.querySelectorAll<HTMLButtonElement>("[data-warrant-crime]").forEach((b) => {
      b.onclick = () => { this.engine.updateCriminalRecord(b.dataset.warrantCrime!, "warrant"); this.renderUi(); };
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-set-med]").forEach((b) => {
      b.onclick = () => { this.engine.updateMedicalRecord(b.dataset.setMed!, "Cleared for Orbital Duty"); this.renderUi(); };
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
    const tabLabels: Record<LocalTab, string> = {
      missions: "Missions",
      market: "Market",
      gateway: "Gateway",
      portfolio: "Portfolio",
      story: "Story & news",
      inbox: `Inbox (${s.emails.length})`,
    };

    panel.innerHTML = `
      <div class="bay-header">
        <h2 class="bay-title">Local gateway terminal</h2>
        <span class="bay-meta">${s.player.gateway.ip}</span>
      </div>
      <div class="tabs">
        ${(Object.keys(tabLabels) as LocalTab[])
          .map((t) => `<button data-tab="${t}" class="${this.activeTab === t ? "active" : ""}">${tabLabels[t]}</button>`)
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
          <div class="row row-stack">
            <div class="row-head">
              <strong>${m.title}</strong>
              <span class="mono">${m.payment >= 0 ? `${m.payment.toLocaleString()}c` : `Fine ${Math.abs(m.payment).toLocaleString()}c`}</span>
            </div>
            <div class="muted">${m.description}</div>
            <div class="controls">
              ${
                m.completed
                  ? `<span class="tag tag-ok">Completed</span>`
                  : m.failed
                    ? `<span class="tag tag-danger">Failed</span>`
                    : m.accepted
                      ? `<button data-complete="${m.id}" class="primary">${m.kind === "pay_fine" ? "Pay fine" : "Submit & claim"}</button>`
                      : `<button data-accept="${m.id}">Accept contract</button>`
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
    } else if (this.activeTab === "market") {
      const filters: { id: MarketFilter; label: string }[] = [
        { id: "software", label: "Core software" },
        { id: "hud_lan", label: "HUD & LAN tools" },
        { id: "hardware", label: "CPUs, modems & security" },
        { id: "gateways", label: "Gateways" },
      ];
      const filterBar = `<div class="controls" style="margin-bottom:4px;">${filters
        .map(
          (f) =>
            `<button data-mfilter="${f.id}" class="${this.marketFilter === f.id ? "primary" : ""}">${f.label}</button>`
        )
        .join("")}</div>`;

      let itemsHtml = "";
      if (this.marketFilter === "software" || this.marketFilter === "hud_lan") {
        const list = SOFTWARE_CATALOG.filter((sw) =>
          this.marketFilter === "hud_lan"
            ? sw.category === "hud" || sw.category === "lan"
            : sw.category !== "hud" && sw.category !== "lan"
        );
        itemsHtml = list
          .map((sw) => {
            const owned = s.player.gateway.software.some((x) => x.id === sw.id && x.version === sw.version);
            return `
              <div class="row">
                <div><strong>${sw.name} v${sw.version}.0</strong> <span class="muted">(${sw.sizeGq} Gq) ${sw.description}</span></div>
                <button data-buy-sw="${sw.id}" data-ver="${sw.version}" ${owned || s.player.credits < sw.cost ? "disabled" : ""}>${owned ? "Owned" : `${sw.cost.toLocaleString()}c`}</button>
              </div>`;
          })
          .join("");
      } else if (this.marketFilter === "hardware") {
        const cpuHtml = CPU_CATALOG.map(
          (c) => `
          <div class="row">
            <div><strong>${c.name}</strong> <span class="muted">Adds or replaces lowest gateway CPU</span></div>
            <button data-buy-cpu="${c.id}" ${s.player.credits < c.cost ? "disabled" : ""}>${c.cost.toLocaleString()}c</button>
          </div>`
        ).join("");
        const modemHtml = MODEM_CATALOG.map(
          (m) => `
          <div class="row">
            <div><strong>${m.name}</strong> <span class="muted">Increases transfer bandwidth up to gateway ceiling</span></div>
            <button data-buy-modem="${m.id}" ${s.player.gateway.modemGbps >= m.gbps || s.player.credits < m.cost ? "disabled" : ""}>${m.cost.toLocaleString()}c</button>
          </div>`
        ).join("");
        const memHtml = MEMORY_CATALOG.map(
          (m) => `
          <div class="row">
            <div><strong>${m.name}</strong> <span class="muted">Expands gateway storage capacity</span></div>
            <button data-buy-mem="${m.id}" ${s.player.credits < m.cost ? "disabled" : ""}>${m.cost.toLocaleString()}c</button>
          </div>`
        ).join("");
        const secHtml = GATEWAY_SECURITY_CATALOG.map((d) => {
          const owned = this.engine.hasSecurityDevice(d.id);
          return `
            <div class="row">
              <div><strong>${d.name}</strong> <span class="muted">${d.description}</span></div>
              <button data-buy-sec="${d.id}" ${owned || s.player.credits < d.cost ? "disabled" : ""}>${owned ? "Installed" : `${d.cost.toLocaleString()}c`}</button>
            </div>`;
        }).join("");
        itemsHtml = cpuHtml + modemHtml + memHtml + secHtml;
      } else {
        const curGw = GATEWAY_CATALOG.find((g) => g.id === s.player.gateway.specId);
        const tradeIn = curGw ? Math.round(curGw.cost * PLAYER_DEFAULTS.gatewayPartExchangeRate) : 0;
        itemsHtml = GATEWAY_CATALOG.filter((g) => g.cost > 0)
          .map((g) => {
            const net = Math.max(0, g.cost - tradeIn);
            const active = s.player.gateway.specId === g.id;
            return `
              <div class="row">
                <div>
                  <strong>${g.name}</strong>
                  <div class="muted">${g.maxCpus} CPUs, ${g.maxMemoryGq} Gq max, ${g.bandwidthGbps} Gq/s, ${g.maxSecuritySlots} security bay(s). ${g.description}</div>
                </div>
                <button data-buy-gw="${g.id}" ${active || s.player.credits < net ? "disabled" : ""}>${active ? "Active" : `${net.toLocaleString()}c`}</button>
              </div>`;
          })
          .join("");
      }

      body.innerHTML = filterBar + itemsHtml;
      body.querySelectorAll<HTMLButtonElement>("[data-mfilter]").forEach((b) => {
        b.onclick = () => { this.marketFilter = b.dataset.mfilter as MarketFilter; this.renderRightPanel(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-sw]").forEach((b) => {
        b.onclick = () => {
          this.engine.buySoftware(b.dataset.buySw as SoftwareId, Number(b.dataset.ver));
          this.renderUi();
        };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-cpu]").forEach((b) => {
        b.onclick = () => { this.engine.buyCpu(b.dataset.buyCpu!); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-modem]").forEach((b) => {
        b.onclick = () => { this.engine.buyModem(b.dataset.buyModem!); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-mem]").forEach((b) => {
        b.onclick = () => { this.engine.buyMemory(b.dataset.buyMem!); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-sec]").forEach((b) => {
        b.onclick = () => { this.engine.buyGatewaySecurity(b.dataset.buySec as GatewaySecurityDevice); this.renderUi(); };
      });
      body.querySelectorAll<HTMLButtonElement>("[data-buy-gw]").forEach((b) => {
        b.onclick = () => { this.engine.upgradeGateway(b.dataset.buyGw!); this.renderUi(); };
      });
    } else if (this.activeTab === "gateway") {
      const gwSpec = GATEWAY_CATALOG.find((g) => g.id === s.player.gateway.specId);
      body.innerHTML = `
        <div class="row">
          <div>
            <strong>${gwSpec?.name ?? s.player.gateway.specId}</strong>
            <div class="muted mono">CPUs: ${s.player.gateway.cpusGhz.join(" + ")} GHz | Security: ${s.player.gateway.securityDevices.join(", ") || "None"}</div>
          </div>
          <div class="controls">
            <button id="btn-defrag">Defrag</button>
            ${this.engine.hasSecurityDevice("self_destruct") ? `<button id="btn-nuke" class="danger">Nuke gateway</button>` : ""}
          </div>
        </div>
        <div class="row">
          <span>Import save JSON</span>
          <input id="import-save" type="file" accept="application/json" />
        </div>
        <div class="muted">Local files (${s.player.gateway.files.length})</div>
        ${
          s.player.gateway.files.length === 0
            ? `<div class="muted">No downloaded files in memory.</div>`
            : s.player.gateway.files
                .map(
                  (f) => `
                  <div class="row">
                    <span class="mono">${f.name} <span class="muted">(${f.sizeGq} Gq, ${f.encryptedLevel > 0 ? `Encrypted L${f.encryptedLevel}` : "Plaintext"})</span></span>
                    ${f.encryptedLevel > 0 ? `<button data-decrypt="${f.id}" class="primary">Decrypt</button>` : ""}
                  </div>`
                )
                .join("")
        }
        <div class="muted">Installed software (${s.player.gateway.software.length})</div>
        ${s.player.gateway.software
          .map((sw) => `<div class="row"><span class="mono">${sw.id.replace(/_/g, " ")} v${sw.version}.0</span><span class="muted mono">${sw.sizeGq} Gq</span></div>`)
          .join("")}
      `;
      body.querySelector<HTMLButtonElement>("#btn-defrag")!.onclick = () => this.engine.startTask("defrag");
      const nukeBtn = body.querySelector<HTMLButtonElement>("#btn-nuke");
      if (nukeBtn) nukeBtn.onclick = () => { this.engine.nukeGateway(); this.renderUi(); };
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
              this.logFeed("Imported save file.");
              this.renderUi();
            } catch {
              this.logFeed("Incompatible save JSON (expected schema v3).");
              this.renderFeed();
            }
          });
        };
      }
    } else if (this.activeTab === "portfolio") {
      if (s.player.portfolio.length === 0) {
        body.innerHTML = `<div class="row"><span class="muted">No equities held. Connect to the International Stock Market System (456.789.159.459) to trade shares.</span></div>`;
      } else {
        body.innerHTML = s.player.portfolio
          .map((h) => {
            const comp = s.companies[h.companyId];
            const curPrice = comp?.currentSharePrice ?? h.avgPurchasePrice;
            const pnl = (curPrice - h.avgPurchasePrice) * h.shares;
            return `
              <div class="row">
                <div>
                  <strong>${comp?.name ?? h.companyId}</strong>
                  <div class="muted mono">${h.shares} shares | Avg ${h.avgPurchasePrice}c | Now ${curPrice}c (${pnl >= 0 ? "+" : ""}${pnl}c)</div>
                </div>
                <button data-port-sell="${h.companyId}" data-port-qty="${h.shares}">Sell all</button>
              </div>`;
          })
          .join("");
        body.querySelectorAll<HTMLButtonElement>("[data-port-sell]").forEach((b) => {
          b.onclick = () => {
            this.engine.sellShares(b.dataset.portSell!, Number(b.dataset.portQty));
            this.renderUi();
          };
        });
      }
    } else if (this.activeTab === "story") {
      const st = s.story;
      body.innerHTML = `
        <div class="row row-stack">
          <div class="row-head">
            <strong>ARC vs. Arunmor (Act ${st.act})</strong>
            <span class="tag tag-info">${st.stage.replace(/_/g, " ")}</span>
          </div>
          <div class="muted mono">Revelation v${st.revelationVersion.toFixed(1)}: ${st.revelationCount}/${REVELATION_WIN_THRESHOLD} | Faith v${st.faithVersion.toFixed(1)}: ${st.faithCount}/${FAITH_WIN_THRESHOLD}</div>
          ${
            st.stage === "dead_agent_email"
              ? `<div class="controls">
                   <button id="btn-join-arc" class="danger">Side with ARC (Revelation)</button>
                   <button id="btn-join-arunmor" class="primary">Side with Arunmor (Faith)</button>
                 </div>`
              : st.stage === "dormant"
                ? `<div class="muted">Reach Novice rating (6+ score) to trigger the dead agent's warning email.</div>`
                : ""
          }
        </div>
        ${s.news
          .map(
            (n) => `
            <div class="row row-stack">
              <div class="row-head">
                <strong>${n.headline}</strong>
                <span class="muted mono">${formatGameDate(n.timestampMs).slice(0, 10)}</span>
              </div>
              <div class="muted">${n.body}</div>
            </div>`
          )
          .join("")}
      `;
      const arcBtn = body.querySelector<HTMLButtonElement>("#btn-join-arc");
      if (arcBtn) arcBtn.onclick = () => { this.engine.joinStoryFaction("arc"); this.renderUi(); };
      const aruBtn = body.querySelector<HTMLButtonElement>("#btn-join-arunmor");
      if (aruBtn) aruBtn.onclick = () => { this.engine.joinStoryFaction("arunmor"); this.renderUi(); };
    } else {
      body.innerHTML = s.emails
        .map(
          (e) => `
          <div class="row row-stack">
            <div class="row-head">
              <strong>${e.subject}</strong>
              <span class="muted mono">${e.from}</span>
            </div>
            <div class="muted" style="white-space:pre-line">${e.body}</div>
          </div>`
        )
        .join("");
    }
  }

  private renderTasks(): void {
    const s = this.engine.getState();
    const list = this.root.querySelector<HTMLElement>("#task-list")!;
    const cpuMeta = this.root.querySelector<HTMLElement>("#cpu-meta")!;
    cpuMeta.textContent = `${s.tasks.length} active | ${this.engine.getTotalCpuGhz()} GHz total`;

    if (s.tasks.length === 0) {
      list.innerHTML = `<div class="muted">No active CPU tasks.</div>`;
      return;
    }

    list.innerHTML = s.tasks
      .map(
        (t) => `
        <div class="row row-stack">
          <div class="row-head">
            <span class="mono">${t.kind.replace(/_/g, " ")} v${t.version}.0 (${t.allocatedGhz.toFixed(0)} GHz)</span>
            <div class="controls">
              <button data-wt-dec="${t.id}">-</button>
              <span class="muted mono">w${t.cpuWeight}</span>
              <button data-wt-inc="${t.id}">+</button>
              <button data-stop="${t.id}" class="danger">Stop</button>
            </div>
          </div>
          <div class="muted mono">${t.statusText}</div>
          <div class="progress-track">
            <div class="progress-fill ${t.kind === "trace_tracker" && s.connection.traceActive ? "danger" : ""}" style="width:${Math.round(t.progress * 100)}%"></div>
          </div>
        </div>`
      )
      .join("");

    list.querySelectorAll<HTMLButtonElement>("[data-stop]").forEach((b) => {
      b.onclick = () => { this.engine.stopTask(b.dataset.stop!); this.renderTasks(); };
    });
    list.querySelectorAll<HTMLButtonElement>("[data-wt-inc]").forEach((b) => {
      b.onclick = () => {
        const t = this.engine.getState().tasks.find((x) => x.id === b.dataset.wtInc);
        if (t) this.engine.setTaskWeight(t.id, t.cpuWeight + 1);
        this.renderTasks();
      };
    });
    list.querySelectorAll<HTMLButtonElement>("[data-wt-dec]").forEach((b) => {
      b.onclick = () => {
        const t = this.engine.getState().tasks.find((x) => x.id === b.dataset.wtDec);
        if (t) this.engine.setTaskWeight(t.id, t.cpuWeight - 1);
        this.renderTasks();
      };
    });
  }

  private renderFeed(): void {
    const feed = this.root.querySelector<HTMLElement>("#event-feed")!;
    feed.innerHTML = this.feed
      .map((line) => `<div class="muted mono" style="padding:2px 0;">${line}</div>`)
      .join("");
  }
}
