import { checkPackDirectory } from "../dist/org/pack-check.js";

const args = process.argv.slice(2); const dirs = []; let serversFile; let invalid = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--servers") {
    if (serversFile !== undefined || !args[i + 1] || args[i + 1].startsWith("-")) { invalid = true; break; }
    serversFile = args[++i];
  } else dirs.push(args[i]);
}
if (invalid || !dirs.length || dirs.some((dir) => dir.startsWith("-"))) {
  console.error("Usage: node scripts/pack-check.mjs [--servers <file>] <packDir>...");
  process.exitCode = 2;
} else {
  let failed = false;
  for (const [index, dir] of dirs.entries()) {
    try {
      const result = checkPackDirectory(dir, serversFile === undefined ? {} : { serversFile });
      const { key, version, seats, skills, digest, capabilities, tools } = result.summary;
      console.log(`Pack ${index + 1}: ${result.ok ? "OK" : "INVALID"}${key ? ` ${key}@${version}` : ""}`);
      console.log(`  seats=${seats} skills=${skills} capabilities=${capabilities} tools=${tools} digest=${digest || "unavailable"}`);
      for (const error of result.errors) console.log(`  error: ${error}`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
      if (!result.ok) failed = true;
    } catch {
      console.log(`Pack ${index + 1}: INVALID\n  error: pack unavailable`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}
