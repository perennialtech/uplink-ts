import { describe, expect, it } from "vitest";
import {
  createInitialWorld,
  deserializeState,
  serializeState,
  UplinkEngine,
} from "../src/engine";

describe("UplinkEngine headless simulation", () => {
  it("generates a deterministic world for a given seed", () => {
    const a = createInitialWorld("ZeroCool", 42);
    const b = createInitialWorld("ZeroCool", 42);
    expect(Object.keys(a.servers)).toEqual(Object.keys(b.servers));
    expect(a.missions.map((m) => m.targetIp)).toEqual(b.missions.map((m) => m.targetIp));
  });

  it("scales trace time by bounce hops and access level", () => {
    const engine = new UplinkEngine(createInitialWorld("Neo", 1234));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    // Direct connection (1 hop)
    const directTime = engine.computeTotalTraceSeconds(["127.0.0.1", testSrv.ip]);
    // Bounced via InterNIC (admin access = 1.0x multiplier)
    const bouncedTime = engine.computeTotalTraceSeconds(["127.0.0.1", internic.ip, testSrv.ip]);

    expect(bouncedTime).toBeGreaterThan(directTime);
    expect(bouncedTime).toBeCloseTo(testSrv.traceSpeedSec * 2, 1);
  });

  it("splits CPU GHz across running tasks and cracks passwords", () => {
    const engine = new UplinkEngine(createInitialWorld("Trinity", 77));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testSrv.ip);
    expect(engine.connect()).toBe(true);

    const tracker = engine.startTask("trace_tracker");
    const cracker = engine.startTask("password_breaker", "admin");
    expect(tracker).not.toBeNull();
    expect(cracker).not.toBeNull();
    expect(engine.getState().connection.traceActive).toBe(true);

    // Advance simulation until password cracks (60 GHz cracking "rosebud" on test machine)
    for (let i = 0; i < 40; i++) {
      engine.tick(0.5);
    }

    expect(engine.getState().connection.authenticatedAs).toBe("admin");
    expect(engine.getState().player.disavowed).toBe(false);
  });

  it("catches players on passive trace unless bounce logs are cleanly wiped with v4", () => {
    // Case 1: Player does NOT wipe InterNIC logs -> caught on passive trace
    const caughtEngine = new UplinkEngine(createInitialWorld("Careless", 99));
    const s1 = Object.values(caughtEngine.getState().servers);
    const internic1 = s1.find((s) => s.kind === "internic")!;
    const test1 = s1.find((s) => s.kind === "uplink_test")!;

    caughtEngine.addBounceNode(internic1.ip);
    caughtEngine.addBounceNode(test1.ip);
    caughtEngine.connect();
    caughtEngine.beginTrace();
    caughtEngine.disconnect();

    expect(caughtEngine.runPassiveTraceAudit(test1.ip)).toBe(true);
    expect(caughtEngine.getState().player.disavowed).toBe(true);

    // Case 2: Player wipes InterNIC bounce log with Log Deleter v4 -> trail goes cold
    const cleanEngine = new UplinkEngine(createInitialWorld("Ghost", 99));
    const s2 = Object.values(cleanEngine.getState().servers);
    const internic2 = s2.find((s) => s.kind === "internic")!;
    const test2 = s2.find((s) => s.kind === "uplink_test")!;

    // Give player credits and install Log Deleter v4
    cleanEngine.acceptMission("mission_tutorial");
    const stateRef = cleanEngine.getState() as unknown as { player: { credits: number } };
    stateRef.player.credits = 10000;
    expect(cleanEngine.buySoftware("log_deleter", 4)).toBe(true);

    cleanEngine.addBounceNode(internic2.ip);
    cleanEngine.addBounceNode(test2.ip);
    cleanEngine.connect();
    cleanEngine.beginTrace();
    cleanEngine.disconnect();

    // Reconnect directly to InterNIC, log in, and wipe bounce log
    cleanEngine.clearRoute();
    cleanEngine.addBounceNode(internic2.ip);
    cleanEngine.connect();
    expect(cleanEngine.login("admin", "admin")).toBe(true);

    const bounceLog = internic2.logs.find((l) => l.type === "bounce")!;
    expect(bounceLog).toBeDefined();
    cleanEngine.startTask("log_deleter", bounceLog.id);
    for (let i = 0; i < 10; i++) cleanEngine.tick(0.5);
    cleanEngine.disconnect();

    expect(cleanEngine.runPassiveTraceAudit(test2.ip)).toBe(false);
    expect(cleanEngine.getState().player.disavowed).toBe(false);
  });

  it("completes a steal-file mission end-to-end and round-trips save JSON", () => {
    const engine = new UplinkEngine(createInitialWorld("AcidBurn", 555));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    expect(engine.acceptMission("mission_tutorial")).toBe(true);
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testSrv.ip);
    engine.connect();
    expect(engine.login("admin", "rosebud")).toBe(true);

    const file = testSrv.files[0]!;
    engine.startTask("file_copier", file.id);
    for (let i = 0; i < 20; i++) engine.tick(0.5);
    engine.disconnect();

    const beforeCredits = engine.getState().player.credits;
    expect(engine.completeMission("mission_tutorial")).toBe(true);
    expect(engine.getState().player.credits).toBe(beforeCredits + 1500);

    // Save & reload round-trip
    const json = serializeState(engine.getState());
    const restored = deserializeState(json);
    expect(restored.player.credits).toBe(beforeCredits + 1500);
    expect(restored.schemaVersion).toBe(1);
  });
});
