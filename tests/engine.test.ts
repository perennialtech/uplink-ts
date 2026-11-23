import { describe, expect, it } from "vitest";
import {
  createInitialWorld,
  deserializeState,
  FIXED_IPS,
  serializeState,
  SOFTWARE_CATALOG,
  UplinkEngine,
} from "../src/engine";

describe("UplinkEngine full parity simulation", () => {
  it("initializes canonical fixed IPs, multiple banks, Stock Market, Medical DB, and Protovision", () => {
    const engine = new UplinkEngine(createInitialWorld("Neo", 12345));
    const state = engine.getState();

    expect(state.servers[FIXED_IPS.INTERNIC]?.name).toBe("InterNIC");
    expect(state.servers[FIXED_IPS.UPLINK_INTERNAL]?.kind).toBe("uplink_internal");
    expect(state.servers[FIXED_IPS.MEDICAL_DB]?.kind).toBe("database_medical");
    expect(state.servers[FIXED_IPS.STOCK_MARKET]?.kind).toBe("stock_market");
    expect(state.servers[FIXED_IPS.PROTOVISION]?.kind).toBe("protovision");
    expect(Object.values(state.servers).filter((s) => s.kind === "bank").length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(state.companies).length).toBeGreaterThanOrEqual(12);
    expect(SOFTWARE_CATALOG.length).toBeGreaterThanOrEqual(65);
  });

  it("completes the tutorial steal_file contract and updates ratings", () => {
    const engine = new UplinkEngine(createInitialWorld("Neo", 12345));
    const state = engine.getState();
    const internic = state.servers[FIXED_IPS.INTERNIC]!;
    const testMachine = state.servers[FIXED_IPS.UPLINK_TEST]!;

    expect(engine.acceptMission("mission_tutorial")).toBe(true);
    engine.addBounceNode(internic.ip);
    engine.addBounceNode(testMachine.ip);
    expect(engine.connect()).toBe(true);

    expect(engine.startTask("password_breaker", "admin")).not.toBeNull();
    engine.tick(15);
    expect(engine.getState().connection.authenticatedAs).toBe("admin");

    expect(engine.startTask("file_copier", testMachine.files[0]!.id)).not.toBeNull();
    engine.tick(10);
    expect(engine.getState().player.gateway.files.some((f) => f.name === "Uplink_Test_Data.dat")).toBe(true);

    engine.disconnect();
    expect(engine.completeMission("mission_tutorial")).toBe(true);
    expect(engine.getState().player.credits).toBe(4500);
  });

  it("enforces Remote Console sys deletion + shutdown for remove_computer missions", () => {
    const engine = new UplinkEngine(createInitialWorld("Destroyer", 777));
    const mission = engine.getState().missions.find((m) => m.kind === "remove_computer")!;
    const target = engine.getState().servers[mission.targetIp]!;
    engine.acceptMission(mission.id);

    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.addBounceNode(target.ip);
    engine.connect();
    engine.login("admin", target.accounts[0]!.password);

    const outCd = engine.runConsoleCommand("cd sys");
    expect(outCd.some((l) => l.includes("sys"))).toBe(true);
    engine.runConsoleCommand("delete");
    expect(target.sysIntact).toBe(false);
    engine.runConsoleCommand("shutdown");
    expect(target.destroyed).toBe(true);
    expect(engine.getState().connection.connected).toBe(false);

    expect(engine.completeMission(mission.id)).toBe(true);
  });

  it("enforces Elliptic-Curve Cypher and Voice Print auth on Central Mainframes", () => {
    const engine = new UplinkEngine(createInitialWorld("Ghost", 404));
    const mainframe = Object.values(engine.getState().servers).find(
      (s) => s.kind === "central_mainframe" && s.requiresCypher && s.requiresVoiceAuth
    )!;
    engine.getState().player.credits = 80000;
    engine.upgradeGateway("gamma");
    engine.buySoftware("decypher", 2);
    engine.buySoftware("voice_analyser", 1);

    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.addBounceNode(FIXED_IPS.UPLINK_INTERNAL);
    engine.addBounceNode(FIXED_IPS.STOCK_MARKET);
    engine.addBounceNode(mainframe.ip);
    engine.connect();

    // Blocked before Cypher and Voice Print pass
    expect(engine.login("admin", mainframe.accounts[0]!.password)).toBe(false);

    engine.startTask("decypher");
    engine.tick(3);
    expect(engine.getState().connection.cypherPassed).toBe(true);

    // Still blocked by Voice Print
    expect(engine.login("admin", mainframe.accounts[0]!.password)).toBe(false);

    engine.startTask("voice_analyser");
    engine.tick(3);
    expect(engine.getState().connection.voicePassed).toBe(true);

    expect(engine.login("admin", mainframe.accounts[0]!.password)).toBe(true);
  });

  it("enforces Firewall blocking on file transfer until bypassed or disabled", () => {
    const engine = new UplinkEngine(createInitialWorld("Breacher", 303));
    const mf = Object.values(engine.getState().servers).find(
      (s) => s.kind === "central_mainframe" && s.files.length > 0 && s.security.some((sec) => sec.kind === "firewall")
    )!;
    engine.getState().player.credits = 80000;
    engine.upgradeGateway("gamma");
    engine.buySoftware("decypher", 2);
    engine.buySoftware("voice_analyser", 1);
    engine.buySoftware("firewall_bypass", 5);

    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.addBounceNode(FIXED_IPS.UPLINK_INTERNAL);
    engine.addBounceNode(FIXED_IPS.STOCK_MARKET);
    engine.addBounceNode(mf.ip);
    engine.connect();
    engine.startTask("decypher");
    engine.startTask("voice_analyser");
    engine.tick(5);
    expect(engine.login("admin", mf.accounts[0]!.password)).toBe(true);

    // Firewall blocks copy
    expect(engine.startTask("file_copier", mf.files[0]!.id)).toBeNull();
    engine.startTask("firewall_bypass");
    expect(engine.startTask("file_copier", mf.files[0]!.id)).not.toBeNull();
  });

  it("supports Log Deleter v3 decoy overwrite and Log UnDeleter recovery", () => {
    const engine = new UplinkEngine(createInitialWorld("Cleaner", 616));
    engine.getState().player.credits = 20000;
    engine.buySoftware("log_deleter", 3);
    engine.buySoftware("log_undeleter", 1);

    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.connect();
    engine.login("admin", "admin");

    const internic = engine.getState().servers[FIXED_IPS.INTERNIC]!;
    const log = internic.logs[0]!;
    const origIp = log.fromIp;
    engine.startTask("log_deleter", log.id);
    engine.tick(3);
    expect(log.type).toBe("overwritten");
    expect(log.suspiciousDeletion).toBe(true);

    engine.startTask("log_undeleter", log.id);
    engine.tick(3);
    expect(log.suspiciousDeletion).toBe(false);
    expect(log.fromIp).toBe(origIp);
  });

  it("supports Stock Market trading and Bank Loans", () => {
    const engine = new UplinkEngine(createInitialWorld("Trader", 505));
    const comp = Object.values(engine.getState().companies)[0]!;
    const startCredits = engine.getState().player.credits;

    expect(engine.buyShares(comp.id, 10)).toBe(true);
    expect(engine.getState().player.credits).toBe(startCredits - comp.currentSharePrice * 10);
    expect(engine.sellShares(comp.id, 10)).toBe(true);
    expect(engine.getState().player.credits).toBe(startCredits);

    // Bank loan
    const bankIp = engine.getState().player.bankIp;
    engine.addBounceNode(bankIp);
    engine.connect();
    expect(engine.loginBankAccount(engine.getState().player.bankAccountNumber, "vault")).toBe(true);
    expect(engine.requestBankLoan(2000)).toBe(true);
    expect(engine.getState().player.credits).toBe(startCredits + 2000);
    expect(engine.repayBankLoan(2000)).toBe(true);
    expect(engine.getState().player.credits).toBe(startCredits);
  });

  it("supports graduated consequences (warning mail, fine), VirtuaNet anonymity, and Gateway Self-Destruct survival", () => {
    // 1. Warning mail on Uplink Test Machine
    const e1 = new UplinkEngine(createInitialWorld("Newbie", 111));
    e1.addBounceNode(FIXED_IPS.UPLINK_TEST);
    e1.connect();
    e1.beginTrace();
    e1.tick(60);
    expect(e1.getState().player.disavowed).toBe(false);
    expect(e1.getState().emails.some((m) => m.subject.includes("caught hacking"))).toBe(true);

    // 2. Tactical seizure on bank -> survive by nuking gateway with Self Destruct!
    const e2 = new UplinkEngine(createInitialWorld("Survivor", 222));
    e2.getState().player.credits = 60000;
    e2.upgradeGateway("beta");
    e2.buyGatewaySecurity("motion_sensor");
    e2.buyGatewaySecurity("self_destruct");

    e2.addBounceNode(e2.getState().player.bankIp);
    e2.connect();
    e2.beginTrace();
    e2.tick(20);
    expect(e2.getState().player.disavowed).toBe(false);
    expect(e2.getState().player.gateway.proximityAlert).toBeGreaterThan(0);

    expect(e2.nukeGateway()).toBe(true);
    e2.tick(600);
    expect(e2.getState().player.disavowed).toBe(false);
    expect(e2.getState().player.gateway.nukedCount).toBe(1);

    // 3. VirtuaNet anonymous gateway deflects federal trace cleanly
    const e3 = new UplinkEngine(createInitialWorld("Anon", 333));
    e3.getState().player.credits = 100000;
    e3.upgradeGateway("virtuanet");
    e3.addBounceNode(e3.getState().player.bankIp);
    e3.connect();
    e3.beginTrace();
    e3.tick(20);
    e3.tick(600);
    expect(e3.getState().player.disavowed).toBe(false);
  });

  it("supports LAN Isolation Bridge toggling and Radio frequency bridging", () => {
    const engine = new UplinkEngine(createInitialWorld("LanRunner", 888));
    engine.getState().player.credits = 150000;
    engine.upgradeGateway("trinity");
    engine.buySoftware("lan_scan", 3);

    const darwinLan = Object.values(engine.getState().servers).find((s) =>
      s.name.includes("Darwin Digital LAN")
    )!;
    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.addBounceNode(darwinLan.ip);
    engine.connect();

    engine.startTask("lan_scan");
    engine.tick(20);
    expect(engine.moveLanNode("d_hub")).toBe(true);
    expect(engine.moveLanNode("d_tx")).toBe(true);
    expect(engine.moveLanNode("d_rx")).toBe(false);
    expect(engine.setLanRadioFrequency(162.4)).toBe(true);
    expect(engine.moveLanNode("d_rx")).toBe(true);
    expect(engine.moveLanNode("d_main")).toBe(true);
  });

  it("supports Medical Database edits and ARC/Arunmor storyline with special missions", () => {
    const engine = new UplinkEngine(createInitialWorld("Medic", 909));
    const medMission = engine.getState().missions.find((m) => m.kind === "change_medical")!;
    engine.acceptMission(medMission.id);
    const cmd = engine.getState().servers[FIXED_IPS.MEDICAL_DB]!;

    engine.addBounceNode(FIXED_IPS.INTERNIC);
    engine.addBounceNode(cmd.ip);
    engine.connect();
    engine.login("admin", cmd.accounts[0]!.password);
    expect(engine.updateMedicalRecord(medMission.targetCitizenId!, medMission.targetValue!)).toBe(true);
    engine.disconnect();
    expect(engine.completeMission(medMission.id)).toBe(true);

    expect(engine.getState().story.stage).toBe("dead_agent_email");
    expect(engine.joinStoryFaction("arunmor")).toBe(true);
    expect(engine.getState().missions.some((m) => m.specialMissionCode === "BACKFIRE")).toBe(true);
  });

  it("round-trips WorldState schema v3 cleanly via serializeState / deserializeState", () => {
    const engine = new UplinkEngine(createInitialWorld("Saver", 777));
    const json = serializeState(engine.getState());
    const restored = deserializeState(json);
    expect(restored.schemaVersion).toBe(3);
    expect(restored.player.handle).toBe("Saver");
    expect(Object.keys(restored.companies).length).toBe(Object.keys(engine.getState().companies).length);
  });
});
