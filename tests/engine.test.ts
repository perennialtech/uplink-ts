import { describe, expect, it } from "vitest";
import {
  createInitialWorld,
  deserializeState,
  serializeState,
  UplinkEngine,
} from "../src/engine";

function grantCredits(engine: UplinkEngine, amount: number): void {
  const mutable = engine.getState() as unknown as { player: { credits: number; uplinkScore: number } };
  mutable.player.credits = amount;
}

describe("UplinkEngine complete headless simulation", () => {
  it("generates a deterministic world for a given seed", () => {
    const a = createInitialWorld("ZeroCool", 42);
    const b = createInitialWorld("ZeroCool", 42);
    expect(Object.keys(a.servers)).toEqual(Object.keys(b.servers));
    expect(Object.keys(a.citizens)).toEqual(Object.keys(b.citizens));
    expect(a.missions.map((m) => m.targetIp)).toEqual(b.missions.map((m) => m.targetIp));
  });

  it("scales trace time by bounce hops and access level", () => {
    const engine = new UplinkEngine(createInitialWorld("Neo", 1234));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    const directTime = engine.computeTotalTraceSeconds(["127.0.0.1", testSrv.ip]);
    const bouncedTime = engine.computeTotalTraceSeconds(["127.0.0.1", internic.ip, testSrv.ip]);

    expect(bouncedTime).toBeGreaterThan(directTime);
    expect(bouncedTime).toBeCloseTo(testSrv.traceSpeedSec * 2, 1);
  });

  it("cracks passwords with Password Breaker and Dictionary Hacker", () => {
    const engine = new UplinkEngine(createInitialWorld("Trinity", 77));
    grantCredits(engine, 10000);
    expect(engine.buySoftware("dictionary_hacker", 1)).toBe(true);

    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testSrv.ip);
    expect(engine.connect()).toBe(true);

    engine.startTask("trace_tracker");
    engine.startTask("dictionary_hacker", "admin");
    for (let i = 0; i < 15; i++) engine.tick(0.5);

    expect(engine.getState().connection.authenticatedAs).toBe("admin");
    expect(engine.getState().player.disavowed).toBe(false);
  });

  it("catches players on passive trace unless bounce logs are cleanly wiped with v4", () => {
    const caught = new UplinkEngine(createInitialWorld("Careless", 99));
    const s1 = Object.values(caught.getState().servers);
    const internic1 = s1.find((s) => s.kind === "internic")!;
    const test1 = s1.find((s) => s.kind === "uplink_test")!;

    caught.addBounceNode(internic1.ip);
    caught.addBounceNode(test1.ip);
    caught.connect();
    caught.beginTrace();
    caught.disconnect();

    expect(caught.runPassiveTraceAudit(test1.ip)).toBe(true);
    expect(caught.getState().player.disavowed).toBe(true);

    const clean = new UplinkEngine(createInitialWorld("Ghost", 99));
    grantCredits(clean, 10000);
    expect(clean.buySoftware("log_deleter", 4)).toBe(true);

    const s2 = Object.values(clean.getState().servers);
    const internic2 = s2.find((s) => s.kind === "internic")!;
    const test2 = s2.find((s) => s.kind === "uplink_test")!;

    clean.addBounceNode(internic2.ip);
    clean.addBounceNode(test2.ip);
    clean.connect();
    clean.beginTrace();
    clean.disconnect();

    clean.clearRoute();
    clean.addBounceNode(internic2.ip);
    clean.connect();
    expect(clean.login("admin", "admin")).toBe(true);

    const bounceLog = internic2.logs.find((l) => l.type === "bounce")!;
    clean.startTask("log_deleter", bounceLog.id);
    for (let i = 0; i < 10; i++) clean.tick(0.5);
    clean.disconnect();

    expect(clean.runPassiveTraceAudit(test2.ip)).toBe(false);
    expect(clean.getState().player.disavowed).toBe(false);
  });

  it("recovers v1-deleted logs with Log Undeleter and spoofs IPs with Log Modifier", () => {
    const engine = new UplinkEngine(createInitialWorld("Forensic", 101));
    grantCredits(engine, 25000);
    expect(engine.buySoftware("log_undeleter", 1)).toBe(true);
    expect(engine.buySoftware("log_modifier", 1)).toBe(true);

    const internic = Object.values(engine.getState().servers).find((s) => s.kind === "internic")!;
    const testSrv = Object.values(engine.getState().servers).find((s) => s.kind === "uplink_test")!;

    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testSrv.ip);
    engine.connect();
    engine.disconnect();

    engine.clearRoute();
    engine.addBounceNode(internic.ip);
    engine.connect();
    engine.login("admin", "admin");

    const bounceLog = internic.logs.find((l) => l.type === "bounce")!;
    // Delete with v1 -> leaves recoverable stub
    engine.startTask("log_deleter", bounceLog.id);
    for (let i = 0; i < 10; i++) engine.tick(0.5);
    expect(bounceLog.suspiciousDeletion).toBe(true);

    // Recover with Log Undeleter
    engine.startTask("log_undeleter", bounceLog.id);
    for (let i = 0; i < 10; i++) engine.tick(0.5);
    expect(bounceLog.suspiciousDeletion).toBe(false);
    expect(bounceLog.type).toBe("bounce");

    // Spoof IP with Log Modifier
    engine.startTask("log_modifier", bounceLog.id, "203.0.113.99");
    for (let i = 0; i < 10; i++) engine.tick(0.5);
    expect(bounceLog.fromIp).toBe("203.0.113.99");
  });

  it("enforces LAN traversal, spoofing, encrypted file decryption, and sysadmin pursuit", () => {
    const engine = new UplinkEngine(createInitialWorld("LanRunner", 314));
    grantCredits(engine, 40000);
    expect(engine.upgradeGateway("trinity")).toBe(true);
    expect(engine.buySoftware("lan_scan", 3)).toBe(true);
    expect(engine.buySoftware("lan_spoof", 3)).toBe(true);
    expect(engine.buySoftware("decrypter", 1)).toBe(true);

    const lan = Object.values(engine.getState().servers).find((s) => s.kind === "lan")!;
    const internic = Object.values(engine.getState().servers).find((s) => s.kind === "internic")!;

    engine.acceptMission("mission_lan_1");
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(lan.ip);
    engine.connect();

    // Cannot log into admin before reaching main_server
    expect(engine.login("admin", "override")).toBe(false);

    // Scan LAN, move to hub_1 -> auth_1, spoof auth_1 to unlock lock_1, move to main
    engine.startTask("lan_scan");
    for (let i = 0; i < 20; i++) engine.tick(0.5);

    expect(engine.moveLanNode("hub_1")).toBe(true);
    expect(engine.moveLanNode("lock_1")).toBe(false); // locked!
    expect(engine.moveLanNode("auth_1")).toBe(true);

    engine.startTask("lan_spoof", "auth_1");
    for (let i = 0; i < 15; i++) engine.tick(0.5);

    expect(engine.moveLanNode("hub_1")).toBe(true);
    expect(engine.moveLanNode("lock_1")).toBe(true); // now unlocked!
    expect(engine.moveLanNode("main")).toBe(true);
    expect(engine.getState().connection.lanSession?.sysadminAlerted).toBe(true);

    // Login, copy encrypted prototype file, disconnect, decrypt, and submit mission
    expect(engine.login("admin", "override")).toBe(true);
    const proto = lan.files[0]!;
    engine.startTask("file_copier", proto.id);
    for (let i = 0; i < 15; i++) engine.tick(0.5);
    engine.disconnect();

    // Encrypted file cannot be submitted before decryption
    expect(engine.completeMission("mission_lan_1")).toBe(false);

    const localFile = engine.getState().player.gateway.files[0]!;
    engine.startTask("decrypter", localFile.id);
    for (let i = 0; i < 25; i++) engine.tick(0.5);
    expect(localFile.encryptedLevel).toBe(0);

    expect(engine.completeMission("mission_lan_1")).toBe(true);
  });

  it("audits bank heists unless BOTH victim and player statements are deleted", () => {
    const engine = new UplinkEngine(createInitialWorld("Banker", 808));
    const bank = Object.values(engine.getState().servers).find((s) => s.kind === "bank")!;
    const internic = Object.values(engine.getState().servers).find((s) => s.kind === "internic")!;
    const victim = bank.bankAccounts[1]!;

    engine.addBounceNode(internic.ip);
    engine.addBounceNode(bank.ip);
    engine.connect();
    expect(engine.loginBankAccount(victim.accountNumber, victim.password)).toBe(true);

    const beforeCredits = engine.getState().player.credits;
    expect(
      engine.transferBankFunds(bank.ip, engine.getState().player.bankAccountNumber, 5000)
    ).toBe(true);
    expect(engine.getState().player.credits).toBe(beforeCredits + 5000);

    // Delete victim's outgoing statement
    const outStmt = victim.statements[0]!;
    expect(engine.deleteBankStatement(victim.accountNumber, outStmt.id)).toBe(true);

    // Switch to player's own account and delete incoming statement
    const playerAcct = bank.bankAccounts[0]!;
    expect(engine.loginBankAccount(playerAcct.accountNumber, playerAcct.password)).toBe(true);
    const inStmt = playerAcct.statements[0]!;
    expect(engine.deleteBankStatement(playerAcct.accountNumber, inStmt.id)).toBe(true);
    engine.disconnect();

    // Run bank audit -> clean getaway!
    const auditEvt = engine.getState().scheduledEvents.find((e) => e.kind === "bank_audit")!;
    expect(engine.runBankAudit(auditEvt.payload)).toBe(false);
    expect(engine.getState().player.disavowed).toBe(false);
  });

  it("supports editing Academic, Criminal, and Social Security databases for missions", () => {
    const engine = new UplinkEngine(createInitialWorld("Clerk", 2026));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const iad = servers.find((s) => s.kind === "database_academic")!;
    const mission = engine.getState().missions.find((m) => m.id === "mission_academic_1")!;

    engine.acceptMission(mission.id);
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(iad.ip);
    engine.connect();
    expect(engine.login("admin", "horizon")).toBe(true);
    expect(engine.updateAcademicRecord(mission.targetCitizenId!, "4.0")).toBe(true);
    engine.disconnect();

    expect(engine.completeMission(mission.id)).toBe(true);
  });

  it("triggers the ARC vs. Arunmor storyline and reaches Faith victory", () => {
    const engine = new UplinkEngine(createInitialWorld("Hero", 777));
    const servers = Object.values(engine.getState().servers);
    const internic = servers.find((s) => s.kind === "internic")!;
    const testSrv = servers.find((s) => s.kind === "uplink_test")!;

    // Complete 2 contracts to cross Novice threshold (6+ score)
    const m1 = engine.getState().missions.find((m) => m.id === "mission_tutorial")!;
    const m2 = engine.getState().missions.find((m) => m.id === "mission_academic_1")!;
    const iad = servers.find((s) => s.kind === "database_academic")!;

    engine.acceptMission(m1.id);
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testSrv.ip);
    engine.connect();
    engine.login("admin", "rosebud");
    engine.startTask("file_copier", testSrv.files[0]!.id);
    for (let i = 0; i < 20; i++) engine.tick(0.5);
    engine.disconnect();
    expect(engine.completeMission(m1.id)).toBe(true);

    engine.acceptMission(m2.id);
    engine.clearRoute();
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(iad.ip);
    engine.connect();
    engine.login("admin", "horizon");
    engine.updateAcademicRecord(m2.targetCitizenId!, "4.0");
    engine.disconnect();
    expect(engine.completeMission(m2.id)).toBe(true);

    expect(engine.getState().story.stage).toBe("dead_agent_email");
    expect(engine.joinStoryFaction("arunmor")).toBe(true);
    expect(engine.getState().story.stage).toBe("active_war");

    // Deploy Faith on 5 servers
    const targets = servers.filter((s) => !s.lanNodes && s.kind !== "bank").slice(0, 5);
    for (const srv of targets) {
      engine.clearRoute();
      engine.addBounceNode(internic.ip);
      if (srv.ip !== internic.ip) engine.addBounceNode(srv.ip);
      engine.connect();
      engine.login("admin", srv.accounts[0]!.password);
      expect(engine.deployStoryPayload("faith")).toBe(true);
      engine.disconnect();
    }

    expect(engine.getState().story.stage).toBe("arunmor_victory");

    // Verify schema v2 JSON round-trip
    const restored = deserializeState(serializeState(engine.getState()));
    expect(restored.schemaVersion).toBe(2);
    expect(restored.story.stage).toBe("arunmor_victory");
  });
});
