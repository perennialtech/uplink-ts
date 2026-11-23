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
  ctx.fillStyle = "#04070b";
  ctx.fillRect(0, 0, LAN_W, LAN_H);

  // Subtle blueprint grid
  ctx.strokeStyle = "rgba(76, 154, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let x = 40; x < LAN_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LAN_H);
    ctx.stroke();
  }
  for (let y = 40; y < LAN_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LAN_W, y);
    ctx.stroke();
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Draw links between visible nodes
  for (const node of nodes) {
    if (!node.visible) continue;
    for (const adjId of node.connectedTo) {
      const adj = byId.get(adjId);
      if (!adj || !adj.visible) continue;
      ctx.strokeStyle = !adj.unlocked || !node.unlocked ? "#e39b38" : "#2e425e";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(node.x, node.y);
      ctx.lineTo(adj.x, adj.y);
      ctx.stroke();
    }
  }

  // Draw RF link if transmitter & receiver visible
  const tx = nodes.find((n) => n.kind === "radio_transmitter" && n.visible);
  const rx = nodes.find((n) => n.kind === "radio_receiver" && n.visible);
  if (tx && rx && rx.radioFreqMhz !== undefined) {
    const matched = Math.abs(session.tunedFreqMhz - rx.radioFreqMhz) < 0.05;
    ctx.save();
    ctx.strokeStyle = matched ? "#4c9aff" : "#445873";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = matched ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(tx.x, tx.y);
    ctx.lineTo(rx.x, rx.y);
    ctx.stroke();
    ctx.restore();
  }

  // Draw nodes
  for (const node of nodes) {
    if (!node.visible) continue;
    const isPlayer = session.currentNodeId === node.id;
    const isSysadmin = session.sysadminNodeId === node.id;
    const isSelected = selectedNodeId === node.id;

    ctx.fillStyle = isSysadmin
      ? "#df4b5b"
      : isPlayer
        ? "#34c77b"
        : !node.unlocked
          ? "#e39b38"
          : node.spoofed
            ? "#9c7cff"
            : node.kind === "main_server"
              ? "#4c9aff"
              : node.kind === "isolation_bridge" || node.kind === "radio_transmitter" || node.kind === "radio_receiver"
                ? "#2d6cb5"
                : "#475d78";

    const r = isPlayer || isSysadmin ? 10 : 8;
    ctx.fillRect(node.x - r, node.y - r, r * 2, r * 2);

    if (isSelected) {
      ctx.strokeStyle = "#dce6f2";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(node.x - r - 4, node.y - r - 4, (r + 4) * 2, (r + 4) * 2);
    }

    ctx.fillStyle = "#dce6f2";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillText(node.label, node.x - 28, node.y + 22);
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
