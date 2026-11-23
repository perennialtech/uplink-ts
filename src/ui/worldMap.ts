import type { ServerNode, WorldState } from "../engine";

const MAP_W = 1000;
const MAP_H = 500;

export class WorldMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onNodeClick: (ip: string) => void;
  private lastState: Readonly<WorldState> | null = null;

  constructor(canvas: HTMLCanvasElement, onNodeClick: (ip: string) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.onNodeClick = onNodeClick;

    this.canvas.addEventListener("click", (ev) => this.handleClick(ev));
  }

  private handleClick(ev: MouseEvent): void {
    if (!this.lastState) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * MAP_W;
    const my = ((ev.clientY - rect.top) / rect.height) * MAP_H;

    let closest: ServerNode | null = null;
    let bestDist = 26;
    for (const srv of Object.values(this.lastState.servers)) {
      if (!srv.discovered) continue;
      const d = Math.hypot(srv.x - mx, srv.y - my);
      if (d < bestDist) {
        bestDist = d;
        closest = srv;
      }
    }
    if (closest) {
      this.onNodeClick(closest.ip);
    }
  }

  render(state: Readonly<WorldState>, nowMs: number): void {
    this.lastState = state;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // Subtle cyber grid
    ctx.fillStyle = "#060b14";
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 50; x < MAP_W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_H);
      ctx.stroke();
    }
    for (let y = 50; y < MAP_H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_W, y);
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
      ctx.strokeStyle = state.connection.connected ? "#38bdf8" : "rgba(56, 189, 248, 0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash(state.connection.connected ? [] : [8, 6]);
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
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(points[startIdx]!.x, points[startIdx]!.y);
        for (let i = startIdx - 1; i >= tracedEndIdx; i--) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        ctx.stroke();

        // Pulsing ring on current trace frontier
        const frontier = points[tracedEndIdx]!;
        const pulse = 8 + ((nowMs / 40) % 14);
        ctx.strokeStyle = "rgba(244, 63, 94, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(frontier.x, frontier.y, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw player gateway
    const gw = state.player.gateway;
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(gw.x - 6, gw.y - 6, 12, 12);
    ctx.fillStyle = "#86efac";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`GATEWAY (${gw.locationCity})`, gw.x + 10, gw.y + 4);

    // Draw discovered servers
    for (const srv of Object.values(state.servers)) {
      if (!srv.discovered) continue;
      const inRoute = route.includes(srv.ip);
      const isTarget = route.length > 1 && route[route.length - 1] === srv.ip;

      ctx.fillStyle = isTarget
        ? "#f59e0b"
        : inRoute
          ? "#38bdf8"
          : srv.kind === "internic"
            ? "#a855f7"
            : "#64748b";

      ctx.beginPath();
      ctx.arc(srv.x, srv.y, isTarget ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();

      if (inRoute || srv.kind === "internic" || srv.kind === "uplink_internal" || srv.kind === "uplink_test") {
        ctx.fillStyle = isTarget ? "#fde68a" : "#cbd5e1";
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(srv.name, srv.x + 9, srv.y + 4);
      }
    }
  }
}
