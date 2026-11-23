import type { ServerNode, WorldState } from "../engine";

const MAP_W = 1000;
const MAP_H = 500;

/** Simplified vector landmass polygons for authentic Uplink global map projection (1000x500) */
const CONTINENTS: readonly (readonly [number, number][])[] = [
  // North America
  [
    [85, 70], [160, 65], [240, 82], [305, 118], [295, 178], [248, 222],
    [210, 245], [178, 232], [140, 195], [105, 145], [75, 102],
  ],
  // South America
  [
    [245, 258], [308, 275], [342, 322], [315, 395], [282, 455], [255, 430], [238, 330],
  ],
  // Europe
  [
    [435, 82], [505, 72], [568, 88], [580, 142], [535, 175], [478, 178], [442, 145],
  ],
  // Africa
  [
    [445, 195], [525, 188], [575, 232], [565, 325], [522, 405], [485, 385], [455, 285], [430, 238],
  ],
  // Asia
  [
    [572, 78], [725, 68], [865, 92], [905, 155], [870, 222], [795, 265],
    [712, 265], [648, 225], [582, 185],
  ],
  // Japan
  [
    [860, 165], [882, 178], [872, 205], [852, 198],
  ],
  // Australia
  [
    [805, 348], [898, 342], [932, 395], [905, 438], [828, 425], [795, 385],
  ],
];

export class WorldMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onNodeClick: (ip: string) => void;
  private lastState: Readonly<WorldState> | null = null;
  private hoveredServer: ServerNode | null = null;

  constructor(canvas: HTMLCanvasElement, onNodeClick: (ip: string) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.onNodeClick = onNodeClick;

    this.canvas.addEventListener("click", (ev) => this.handleClick(ev));
    this.canvas.addEventListener("mousemove", (ev) => this.handleHover(ev));
    this.canvas.addEventListener("mouseleave", () => {
      this.hoveredServer = null;
    });
  }

  private findClosest(ev: MouseEvent, radius = 26): ServerNode | null {
    if (!this.lastState) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * MAP_W;
    const my = ((ev.clientY - rect.top) / rect.height) * MAP_H;

    let closest: ServerNode | null = null;
    let bestDist = radius;
    for (const srv of Object.values(this.lastState.servers)) {
      if (!srv.discovered || srv.destroyed) continue;
      const d = Math.hypot(srv.x - mx, srv.y - my);
      if (d < bestDist) {
        bestDist = d;
        closest = srv;
      }
    }
    return closest;
  }

  private handleClick(ev: MouseEvent): void {
    const closest = this.findClosest(ev, 26);
    if (closest) {
      this.onNodeClick(closest.ip);
    }
  }

  private handleHover(ev: MouseEvent): void {
    this.hoveredServer = this.findClosest(ev, 22);
  }

  render(state: Readonly<WorldState>, nowMs: number): void {
    this.lastState = state;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // Base vector-scope ocean
    ctx.fillStyle = "#06090e";
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // Subtle lat/lon graticule
    ctx.strokeStyle = "rgba(76, 154, 255, 0.07)";
    ctx.lineWidth = 1;
    for (let x = 100; x < MAP_W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_H);
      ctx.stroke();
    }
    for (let y = 100; y < MAP_H; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_W, y);
      ctx.stroke();
    }

    // Stylized vector continents
    ctx.fillStyle = "rgba(28, 46, 72, 0.42)";
    ctx.strokeStyle = "rgba(76, 154, 255, 0.24)";
    ctx.lineWidth = 1.2;
    for (const poly of CONTINENTS) {
      ctx.beginPath();
      ctx.moveTo(poly[0]![0], poly[0]![1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i]![0], poly[i]![1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Draw bounce route
    const route = state.connection.route;
    if (route.length >= 2) {
      const points = route.map((ip) => {
        if (ip === state.player.gateway.ip) {
          return { x: state.player.gateway.x, y: state.player.gateway.y };
        }
        const srv = state.servers[ip];
        return srv ? { x: srv.x, y: srv.y } : { x: 0, y: 0 };
      });

      ctx.save();
      ctx.strokeStyle = state.connection.connected ? "#4c9aff" : "rgba(76, 154, 255, 0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash(state.connection.connected ? [] : [7, 5]);
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i]!.x, points[i]!.y);
      }
      ctx.stroke();
      ctx.restore();

      // Active trace red overlay marching backward from target
      if (state.connection.traceActive) {
        const hopsCompleted = state.connection.traceHopsCompleted;
        const startIdx = points.length - 1;
        const tracedEndIdx = Math.max(0, startIdx - hopsCompleted);

        ctx.save();
        ctx.strokeStyle = "#df4b5b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(points[startIdx]!.x, points[startIdx]!.y);
        for (let i = startIdx - 1; i >= tracedEndIdx; i--) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        ctx.stroke();

        // Pulsing ring on current trace frontier
        const frontier = points[tracedEndIdx]!;
        const pulse = 7 + ((nowMs / 45) % 14);
        ctx.strokeStyle = "rgba(223, 75, 91, 0.75)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(frontier.x, frontier.y, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw player gateway
    const gw = state.player.gateway;
    ctx.fillStyle = "#34c77b";
    ctx.fillRect(gw.x - 5, gw.y - 5, 10, 10);
    ctx.strokeStyle = "#9ce6b4";
    ctx.lineWidth = 1;
    ctx.strokeRect(gw.x - 8, gw.y - 8, 16, 16);
    ctx.fillStyle = "#9ce6b4";
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(`Gateway (${gw.locationCity})`, gw.x + 12, gw.y + 4);

    // Draw discovered servers
    for (const srv of Object.values(state.servers)) {
      if (!srv.discovered) continue;
      const inRoute = route.includes(srv.ip);
      const isTarget = route.length > 1 && route[route.length - 1] === srv.ip;
      const isHovered = this.hoveredServer?.ip === srv.ip;

      if (srv.destroyed) {
        ctx.strokeStyle = "#6b212a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(srv.x - 4, srv.y - 4);
        ctx.lineTo(srv.x + 4, srv.y + 4);
        ctx.moveTo(srv.x + 4, srv.y - 4);
        ctx.lineTo(srv.x - 4, srv.y + 4);
        ctx.stroke();
        continue;
      }

      ctx.fillStyle = srv.revelationInfected
        ? "#df4b5b"
        : isTarget
          ? "#e39b38"
          : inRoute
            ? "#4c9aff"
            : srv.kind === "internic"
              ? "#9c7cff"
              : srv.kind === "bank"
                ? "#34c77b"
                : "#647a96";

      const size = isTarget || isHovered ? 6 : 4;
      ctx.fillRect(srv.x - size, srv.y - size, size * 2, size * 2);

      if (srv.playerAccess !== "none") {
        ctx.strokeStyle = srv.playerAccess === "admin" ? "#4c9aff" : "#7e93ad";
        ctx.lineWidth = 1;
        ctx.strokeRect(srv.x - size - 3, srv.y - size - 3, (size + 3) * 2, (size + 3) * 2);
      }

      if (
        isHovered ||
        inRoute ||
        srv.kind === "internic" ||
        srv.kind === "uplink_internal" ||
        srv.kind === "uplink_test"
      ) {
        ctx.fillStyle = isTarget || isHovered ? "#eef6ff" : "#b5c6dc";
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.fillText(srv.name, srv.x + 10, srv.y + 4);
      }
    }

    // Hover telemetry HUD inside map corner
    if (this.hoveredServer) {
      const h = this.hoveredServer;
      const text = `${h.name} [${h.ip}]  Access: ${h.playerAccess}`;
      ctx.fillStyle = "rgba(7, 10, 15, 0.9)";
      ctx.fillRect(10, MAP_H - 30, Math.min(MAP_W - 20, text.length * 7.2 + 18), 22);
      ctx.strokeStyle = "#324764";
      ctx.strokeRect(10, MAP_H - 30, Math.min(MAP_W - 20, text.length * 7.2 + 18), 22);
      ctx.fillStyle = "#dce6f2";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(text, 18, MAP_H - 15);
    }
  }
}
