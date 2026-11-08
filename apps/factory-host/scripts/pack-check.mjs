import { checkPackDirectory } from "../dist/org/pack-check.js";

const dirs = process.argv.slice(2);
if (!dirs.length || dirs.some((dir) => dir.startsWith("-"))) {
  console.error("Usage: node scripts/pack-check.mjs <packDir>...");
  process.exitCode = 2;
} else {
  let failed = false;
  for (const [index, dir] of dirs.entries()) {
    try {
      const result = checkPackDirectory(dir);
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
