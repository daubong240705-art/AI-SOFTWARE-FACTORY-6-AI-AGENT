import { listBackups } from "./service.js";
import { restoreBackup } from "./restore.js";

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list" && args.length === 1 && args[0]) {
    process.stdout.write(`${JSON.stringify(listBackups(args[0]))}\n`);
  } else if (command === "restore" && (args.length === 2 || (args.length === 4 && args[2] === "--migrations")) && args[0] && args[1]) {
    const result = restoreBackup({ backupFile: args[0], stateDir: args[1],
      ...(args[3] === undefined ? {} : { migrationsDir: args[3] }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    throw new Error("Usage: list <dir> | restore <backupFile> <stateDir> [--migrations <dir>]");
  }
} catch (error) {
  const message = error instanceof Error && /^(Backup verification|Restore |Target database |State directory |Usage:)/.test(error.message)
    ? error.message : "Backup command failed";
  process.stderr.write(`${message.replace(/[\r\n]+/g, " ")}\n`);
  process.exitCode = 1;
}
