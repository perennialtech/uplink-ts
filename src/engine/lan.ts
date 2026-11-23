import type { LanNode, LanSession, ServerNode } from "./types";

/**
 * Corporate LAN traversal, Isolation Bridge toggling, Radio frequency linking,
 * and Sysadmin AI pursuit aligned with original Uplink LanComputer / LanMonitor.
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
    tunedFreqMhz: 140.0,
    spoofedNodeIds: [],
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

  // Radio transmitter -> receiver jump when frequency matches
  const radioJump =
    current.kind === "radio_transmitter" &&
    target.kind === "radio_receiver" &&
    target.radioFreqMhz !== undefined &&
    Math.abs(session.tunedFreqMhz - target.radioFreqMhz) < 0.05;

  if (!radioJump && !current.connectedTo.includes(target.id)) {
    return { ok: false, reason: "Not directly connected to your current LAN node." };
  }
  if (!target.unlocked) {
    if (target.requiresNodeId) {
      const req = nodes.find((n) => n.id === target.requiresNodeId);
      if (req && (req.spoofed || session.spoofedNodeIds.includes(req.id))) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `Locked. Spoof ${req?.label ?? target.requiresNodeId} or use LAN Force.`,
      };
    }
    return { ok: false, reason: "Node is locked. Use LAN Force or spoof its Auth Server." };
  }
  return { ok: true };
}

export function toggleIsolationBridge(
  nodes: LanNode[],
  bridgeNodeId: string
): { ok: boolean; message: string } {
  const bridge = nodes.find((n) => n.id === bridgeNodeId && n.kind === "isolation_bridge");
  if (!bridge || !bridge.bridgeLocks) {
    return { ok: false, message: "Selected node is not an Isolation Bridge." };
  }
  const [lockAId, lockBId] = bridge.bridgeLocks;
  const lockA = nodes.find((n) => n.id === lockAId);
  const lockB = nodes.find((n) => n.id === lockBId);
  if (!lockA || !lockB) return { ok: false, message: "Bridge locks misconfigured." };

  // Toggle mutually exclusive locks (original Uplink Isolation Bridge behavior)
  lockA.unlocked = !lockA.unlocked;
  lockB.unlocked = !lockA.unlocked;
  return {
    ok: true,
    message: `Isolation Bridge flipped: ${lockA.label} ${lockA.unlocked ? "OPEN" : "LOCKED"}, ${lockB.label} ${lockB.unlocked ? "OPEN" : "LOCKED"}.`,
  };
}

export function tuneLanRadio(
  nodes: readonly LanNode[],
  session: LanSession,
  freqMhz: number
): { ok: boolean; matchedReceiver?: LanNode; message: string } {
  const clamped = Math.max(140, Math.min(180, Math.round(freqMhz * 10) / 10));
  session.tunedFreqMhz = clamped;
  const receiver = nodes.find(
    (n) =>
      n.kind === "radio_receiver" &&
      n.radioFreqMhz !== undefined &&
      Math.abs(n.radioFreqMhz - clamped) < 0.05
  );
  if (receiver) {
    receiver.visible = true;
    receiver.visibility = 3;
    return {
      ok: true,
      matchedReceiver: receiver,
      message: `Radio locked at ${clamped.toFixed(1)} GHz — ${receiver.label} link established.`,
    };
  }
  return {
    ok: true,
    message: `Radio tuned to ${clamped.toFixed(1)} GHz — static only.`,
  };
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
