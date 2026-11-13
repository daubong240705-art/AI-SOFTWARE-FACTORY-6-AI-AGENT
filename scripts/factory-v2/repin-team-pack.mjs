// Moves existing teams onto the newer version of their pack (profiles and skills are pinned per team by digest).
//   node scripts/factory-v2/repin-team-pack.mjs [--dry-run]     (stop the Host first)
// Only a team whose seat names equal the new pack's seat names is moved; running attempts keep the instructions
// they started with. The database is copied next to itself first.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.FACTORY_V2_HOME ?? join(homedir(), "factory-v2");
const app = join(root, "app", "apps", "factory-host");
const dry = process.argv.includes("--dry-run");
const dbPath = join(process.env.FACTORY_STATE_DIR ?? join(root, "state"), "host.db");
const { default: Database } = await import(pathToFileURL(join(app, "node_modules", "better-sqlite3", "lib", "index.js")).href);
const { loadPack } = await import(pathToFileURL(join(app, "dist", "org", "pack.js")).href);
const { capturePackSnapshot } = await import(pathToFileURL(join(app, "dist", "instructions", "snapshot.js")).href);

if (!existsSync(dbPath)) { console.error(`no database at ${dbPath}`); process.exit(1); }
if (existsSync(join(dirname(dbPath), ".host-running"))) { console.error("the Host is running: stop it first"); process.exit(1); }
function dirname(path) { return path.slice(0, path.lastIndexOf("/")); }
const packsDir = join(root, "app", "packs");
const db = new Database(dbPath);
if (!dry) copyFileSync(dbPath, `${dbPath}.before-repin-${Date.now()}`);
let moved = 0;
for (const name of readdirSync(packsDir).filter((entry) => !entry.startsWith("_"))) {
  let pack; try { pack = loadPack(join(packsDir, name)); } catch { continue; }
  const { key, version } = pack.manifest;
  const seatNames = pack.manifest.seats.map((seat) => seat.name).sort().join(",");
  for (const team of db.prepare("SELECT id, pack_version, pack_digest FROM teams WHERE pack_key = ? AND (pack_version <> ? OR pack_digest IS NOT ?)").all(key, version, pack.digest)) {
    const have = db.prepare("SELECT name FROM seats WHERE team_id = ? ORDER BY name").all(team.id).map((seat) => seat.name).sort().join(",");
    if (have !== seatNames) { console.log(`skip ${key} team ${team.id}: seats differ`); continue; }
    console.log(`${dry ? "would move" : "moving"} ${key} team ${team.id}: ${team.pack_version} -> ${version}`);
    if (dry) continue;
    db.transaction(() => {
      capturePackSnapshot(db, pack, new Date());
      db.prepare("UPDATE teams SET pack_version = ?, pack_digest = ?, revision = revision + 1 WHERE id = ?").run(version, pack.digest, team.id);
    })();
    moved++;
  }
}
console.log(dry ? "dry run: nothing changed" : `${moved} team(s) moved`);
