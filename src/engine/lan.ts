import type { LanNode, LanSession, ServerNode } from "./types";

/**
 * Pure graph helpers for Corporate LAN traversal and Sysadmin AI pursuit.
 */
export function createLanSession(server: ServerNode): LanSession | null {
  if (!server.lanNodes || server.lanNodes.length === 0) return null;
  const router = server.lanNodes.find((n) => n.kind === "router") ?? server.lanNodes[0]!;
  return {
    serverIp: server.ip,
    currentNodeId: router.id,
    sysadminNodeId: null,
    sysadminAlerted: false,
    sysadminStepTimerSec: 0,
  };
}

export function canMoveToLanNode(
  nodes: readonly LanNode[],
  session: LanSession,
  targetNodeId: string
): { ok: boolean; reason?: string } {
  const current = nodes.find((n) => n.id === session.currentNodeId);
  const target = nodes.find((n) => n.id === targetNodeId);
  if (!current || !target) return { ok: false, reason: "Unknown LAN node." };
  if (!target.visible) return { ok: false, reason: "Node not discovered yet. Run LAN Scan." };
  if (!current.connectedTo.includes(target.id)) {
    return { ok: false, reason: "Not directly connected to your current LAN node." };
  }
  if (!target.unlocked) {
    if (target.requiresNodeId) {
      const req = nodes.find((n) => n.id === target.requiresNodeId);
      if (req && req.spoofed) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `Locked! Spoof ${req?.label ?? target.requiresNodeId} or use LAN Force.`,
      };
    }
    return { ok: false, reason: "Node is locked. Use LAN Force or spoof its Auth Server." };
  }
  return { ok: true };
}

export function alertLanSysadmin(nodes: readonly LanNode[], session: LanSession): void {
  if (session.sysadminAlerted) return;
  const main = nodes.find((n) => n.kind === "main_server") ?? nodes[nodes.length - 1]!;
  session.sysadminAlerted = true;
  session.sysadminNodeId = main.id;
  session.sysadminStepTimerSec = 4.0;
}

/**
 * BFS shortest path next hop from startId toward goalId across the LAN graph.
 */
export function nextStepToward(
  nodes: readonly LanNode[],
  startId: string,
  goalId: string
): string | null {
  if (startId === goalId) return startId;
  const map = new Map(nodes.map((n) => [n.id, n]));
  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    const node = map.get(last);
    if (!node) continue;
    for (const neighbor of node.connectedTo) {
      if (neighbor === goalId) {
        return path[1] ?? neighbor;
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return null;
}

export function isOnLanMainServer(nodes: readonly LanNode[], session: LanSession | null): boolean {
  if (!session) return false;
  const cur = nodes.find((n) => n.id === session.currentNodeId);
  return cur?.kind === "main_server";
}
