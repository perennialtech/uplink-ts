import type { ConsoleState, ServerNode } from "./types";

export function createInitialConsole(): ConsoleState {
  return {
    currentDir: "/",
    lines: ["Console session started", "Type 'help' for available commands."],
  };
}

export interface ConsoleExecResult {
  output: string[];
  deletedSys?: boolean;
  deletedUsr?: boolean;
  deletedLogs?: boolean;
  runProgram?: "revelation" | "faith";
  shutdown?: boolean;
  disconnect?: boolean;
  exit?: boolean;
}

/**
 * Executes authentic Uplink Remote Admin Console commands (consolescreen_interface.cpp):
 * help, dir, cd <dir>, delete, run <program>, shutdown, exit, disconnect
 */
export function executeConsoleCommand(
  consoleState: ConsoleState,
  target: ServerNode,
  rawCommand: string
): ConsoleExecResult {
  const trimmed = rawCommand.trim();
  const lc = trimmed.toLowerCase();
  const out: string[] = [];
  const res: ConsoleExecResult = { output: out };

  const push = (line: string) => {
    out.push(line);
    consoleState.lines.push(line);
  };

  push(`${consoleState.currentDir}:>${trimmed}`);

  if (lc === "help") {
    push("Available commands:");
    push("  help             - Display this command list");
    push("  dir              - List directory contents");
    push("  cd <dir>         - Change directory (pub, usr, log, rec, sys, ..)");
    push("  delete           - Delete all files in current directory (usr, log, sys)");
    push("  run <program>    - Execute a program stored in /usr (e.g. revelation, faith)");
    push("  shutdown         - Reboot/shutdown system (destroys host if /sys deleted)");
    push("  exit             - Close console session");
    push("  disconnect       - Sever remote connection");
  } else if (lc === "dir") {
    if (consoleState.currentDir === "/") {
      push("pub               directory");
      push("usr               directory");
      push("log               directory");
      push("rec               directory");
      push("sys               directory");
    } else if (consoleState.currentDir === "sys") {
      if (!target.sysIntact) {
        push("No files found");
      } else {
        push("Directory listing of SYS:");
        push("   boot.sys");
        push("   os.sys");
        push("   kernel.sys");
      }
    } else if (consoleState.currentDir === "usr") {
      push("Directory listing for USR:");
      if (target.files.length === 0) {
        push("No files found");
      } else {
        for (const f of target.files) {
          push(`   ${f.name}    ${f.sizeGq}Gq${f.encryptedLevel > 0 ? ` [ENC L${f.encryptedLevel}]` : ""}`);
        }
      }
    } else if (consoleState.currentDir === "log") {
      push("Directory listing for LOG:");
      if (target.logs.length === 0) {
        push("No files found");
      } else {
        for (const l of target.logs.slice(0, 15)) {
          push(`   ${l.detail}`);
        }
      }
    } else if (consoleState.currentDir === "pub") {
      push("Directory listing for PUB:");
      push("Not accessible from console.");
    } else if (consoleState.currentDir === "rec") {
      push("Directory listing for REC:");
      push("Not accessible from console.");
    }
  } else if (lc.startsWith("cd ")) {
    const dir = lc.slice(3).trim();
    if (dir === "pub" || dir === "usr" || dir === "log" || dir === "rec" || dir === "sys" || dir === "/") {
      consoleState.currentDir = dir;
      push(`Changed directory to ${dir}`);
    } else if (dir === "." || dir === "..") {
      consoleState.currentDir = "/";
      push("Changed directory to /");
    } else {
      push("Unrecognised directory");
    }
  } else if (lc === "delete") {
    if (consoleState.currentDir === "sys") {
      if (!target.sysIntact) {
        push("SYS directory already empty.");
      } else {
        target.sysIntact = false;
        res.deletedSys = true;
        push("Deleting boot.sys...");
        push("Deleting os.sys...");
        push("Deleting kernel.sys...");
        push("All system files deleted. Rebooting will render host inoperable.");
      }
    } else if (consoleState.currentDir === "usr") {
      const count = target.files.length;
      target.files = [];
      res.deletedUsr = true;
      push(`Deleted ${count} file(s) from USR.`);
    } else if (consoleState.currentDir === "log") {
      const count = target.logs.length;
      target.logs = [];
      res.deletedLogs = true;
      push(`Deleted ${count} log(s) from LOG.`);
    } else {
      push("Cannot delete files in this directory.");
    }
  } else if (lc.startsWith("run ")) {
    const prog = lc.slice(4).trim();
    if (prog.includes("revelation")) {
      res.runProgram = "revelation";
      push("Executing Revelation...");
    } else if (prog.includes("faith")) {
      res.runProgram = "faith";
      push("Executing Faith...");
    } else {
      push(`Program '${prog}' not found or not executable.`);
    }
  } else if (lc === "shutdown") {
    res.shutdown = true;
    if (!target.sysIntact) {
      target.destroyed = true;
      push("Shutting down system...");
      push("CRITICAL ERROR: kernel.sys not found.");
      push("System halted permanently. Connection terminated.");
    } else {
      push("System rebooting... Connection terminated.");
    }
  } else if (lc === "exit") {
    res.exit = true;
    push("Console session closed.");
  } else if (lc === "disconnect") {
    res.disconnect = true;
    push("Disconnecting...");
  } else if (lc.length > 0) {
    push("Unrecognised text");
  }

  if (consoleState.lines.length > 60) {
    consoleState.lines = consoleState.lines.slice(-60);
  }
  return res;
}
