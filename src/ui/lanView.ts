import type { LanNode, LanSession } from "../engine";

const LAN_W = 560;
const LAN_H = 270;

export function renderLanCanvas(
  canvas: HTMLCanvasElement,
  nodes: readonly LanNode[],
  session: LanSession,
  selectedNodeId: string | null
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, LAN_W, LAN_H);
  ctx.fillStyle = "#040811";
  ctx.fillRect(0, 0, LAN_W, LAN_H);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Draw links between visible nodes
  for (const node of nodes) {
    if (!node.visible) continue;
    for (const adjId of node.connectedTo) {
      const adj = byId.get(adjId);
      if (!adj || !adj.visible) continue;
      ctx.strokeStyle = !adj.unlocked || !node.unlocked ? "#f59e0b" : "#334155";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(node.x, node.y);
      ctx.lineTo(adj.x, adj.y);
      ctx.stroke();
    }
  }

  // Draw nodes
  for (const node of nodes) {
    if (!node.visible) continue;
    const isPlayer = session.currentNodeId === node.id;
    const isSysadmin = session.sysadminNodeId === node.id;
    const isSelected = selectedNodeId === node.id;

    ctx.fillStyle = isSysadmin
      ? "#f43f5e"
      : isPlayer
        ? "#22c55e"
        : !node.unlocked
          ? "#f59e0b"
          : node.spoofed
            ? "#a855f7"
            : node.kind === "main_server"
              ? "#38bdf8"
              : "#475569";

    ctx.beginPath();
    ctx.arc(node.x, node.y, isPlayer || isSysadmin ? 11 : 9, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(node.label, node.x - 24, node.y + 24);
  }
}

export function findClickedLanNode(
  canvas: HTMLCanvasElement,
  ev: MouseEvent,
  nodes: readonly LanNode[]
): LanNode | null {
  const rect = canvas.getBoundingClientRect();
  const mx = ((ev.clientX - rect.left) / rect.width) * LAN_W;
  const my = ((ev.clientY - rect.top) / rect.height) * LAN_H;
  for (const node of nodes) {
    if (!node.visible) continue;
    if (Math.hypot(node.x - mx, node.y - my) <= 18) {
      return node;
    }
  }
  return null;
}
