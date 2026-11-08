import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { capturePackSnapshot, getSeatInstructions, getSkill, backfillPackSnapshots } from "../dist/instructions/snapshot.js";
import { registryEntry } from "../dist/org/registry.js";
import { ensureTeamFromPack, listSeats } from "../dist/org/service.js";
import { startHost } from "../dist/host.js";
import { openStorage } from "../dist/storage/database.js";
import { diskPack, instructionsFixture } from "./instructions-fixture.mjs";
import { migrationsDir, temp } from "./org-fixture.mjs";

test("loaded pack includes profile paths and content", t => { const p = diskPack(t).load(); assert.deepEqual(p.files.profiles.map(x => x.path), ["lead.md", "worker.md"]); assert.equal(p.files.profiles[1].content, "Pinned worker profile"); });
test("loaded pack includes named skill and frontmatter description", t => { const p = diskPack(t).load(); assert.deepEqual(p.files.skills.map(({name,path,description}) => ({name,path,description})), [{name:"verify",path:"skills/verify/SKILL.md",description:"Verify the deliverable."}]); });
test("pack digest and captured files are stable", t => { const p = diskPack(t); assert.deepEqual(p.load(), p.load()); });
test("editing skill bytes changes digest", t => { const p = diskPack(t); const before = p.load(); writeFileSync(join(p.dir,"skills/verify/SKILL.md"), "Changed skill"); assert.notEqual(p.load().digest, before.digest); });
test("editing profile bytes changes digest", t => { const p = diskPack(t); const before = p.load(); writeFileSync(join(p.dir,"worker.md"), "Changed profile"); assert.notEqual(p.load().digest, before.digest); });
for (const [label, content, expected] of [
  ["absent", "Skill body", ""], ["outside frontmatter", "Body\ndescription: ignored", ""],
  ["CRLF", "---\r\nname: verify\r\ndescription: Verify work.\r\n---\r\nBody", "Verify work."],
  ["quoted", '---\ndescription: "Verify work."\n---\nBody', "Verify work."],
  ["single quoted", "---\ndescription: 'Verify work.'\n---\nBody", "Verify work."],
  ["bounded", `---\ndescription: ${"x".repeat(300)}\n---\nBody`, "x".repeat(250)],
  ["empty", "---\ndescription:\n---\nBody", ""],
]) test(`description parsing handles ${label}`, t => assert.equal(diskPack(t,{content}).load().files.skills[0].description,expected));
for (const file of ["worker.md","skills/verify/SKILL.md"]) for (const [label,content] of [["oversized", "x".repeat(65537)],["NUL", "unsafe\0content"],["multibyte oversized", "界".repeat(21846)]])
  test(`${file === "worker.md" ? "profile" : "skill"} rejects ${label}`, t => { const p=diskPack(t); writeFileSync(join(p.dir,file),content); assert.throws(p.load,/Invalid pack content/); });
for (const file of ["worker.md","skills/verify/SKILL.md"]) test(`${file === "worker.md" ? "profile" : "skill"} accepts exactly 65536 bytes`, t => { const p=diskPack(t); writeFileSync(join(p.dir,file),"x".repeat(65536)); assert.ok(p.load()); });
test("capture is idempotent and keeps its first timestamp", t => { const f=instructionsFixture(t); capturePackSnapshot(f.raw,f.pack,"2099-01-01"); assert.equal(f.raw.prepare("SELECT count(*) n FROM pack_snapshots WHERE digest=?").get(f.pack.digest).n,1); assert.equal(f.raw.prepare("SELECT captured_at FROM pack_snapshots WHERE digest=?").get(f.pack.digest).captured_at,f.clock().toISOString()); });
test("teams sharing a digest reuse captured file rows", t => { const f=instructionsFixture(t); f.raw.prepare("INSERT INTO teams (id,revision,name,charter,lifecycle,pack_digest) VALUES (?,1,'Shared','Shared','active',?)").run(randomUUID(),f.pack.digest); assert.equal(f.raw.prepare("SELECT count(*) n FROM pack_files WHERE digest=?").get(f.pack.digest).n,3); });
test("team creation stores the snapshot digest", t => { const f=instructionsFixture(t); assert.equal(f.raw.prepare("SELECT pack_digest FROM teams WHERE id=?").get(f.team.teamId).pack_digest,f.pack.digest); });
test("same pack version preserves team and snapshot", t => { const f=instructionsFixture(t); writeFileSync(join(f.disk.dir,"worker.md"),"Edited"); const next=f.create(f.disk.load()); assert.equal(next.teamId,f.team.teamId); assert.equal(getSeatInstructions(f.raw,{seatId:f.instructionSeat.id}).profile,"Pinned worker profile"); });
test("bumped version creates a team with changed instructions", t => { const f=instructionsFixture(t); writeFileSync(join(f.disk.dir,"worker.md"),"Updated profile"); const manifest={...f.pack.manifest,version:"1.0.1"}; writeFileSync(join(f.disk.dir,"pack.json"),JSON.stringify(manifest)); const next=f.create(f.disk.load()); assert.notEqual(next.teamId,f.team.teamId); const seat=listSeats(f.raw,next.teamId).find(s=>s.name==="BE"); assert.equal(getSeatInstructions(f.raw,{seatId:seat.id}).profile,"Updated profile"); });
test("seat lookup selects the matching profile", t => { const f=instructionsFixture(t); const lead=listSeats(f.raw,f.team.teamId).find(s=>s.isLead); assert.equal(getSeatInstructions(f.raw,{seatId:lead.id}).profile,"Synthetic Lead profile"); assert.equal(getSeatInstructions(f.raw,{seatId:f.instructionSeat.id}).profilePath,"worker.md"); });
test("seat lookup returns a short catalog", t => { const f=instructionsFixture(t); assert.deepEqual(getSeatInstructions(f.raw,{seatId:f.instructionSeat.id}).skills,[{name:"verify",description:"Verify the deliverable."}]); });
for (const kind of ["unknown seat","no snapshot","unmatched seat"]) test(`seat lookup returns null for ${kind}`, t=>{const f=instructionsFixture(t);let seatId=f.instructionSeat.id;if(kind==="unknown seat")seatId=randomUUID();if(kind==="no snapshot")f.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(f.team.teamId);if(kind==="unmatched seat")f.raw.prepare("UPDATE seats SET name='Unmatched' WHERE id=?").run(seatId);assert.equal(getSeatInstructions(f.raw,{seatId}),null);});
test("skill lookup returns captured content",t=>{const f=instructionsFixture(t);assert.equal(getSkill(f.raw,{seatId:f.instructionSeat.id,name:"verify"}),f.pack.files.skills[0].content);});
for(const kind of ["unknown skill","unknown seat","other team"])test(`skill lookup refuses ${kind}`,t=>{const f=instructionsFixture(t);assert.equal(getSkill(f.raw,{seatId:kind==="unknown seat"?randomUUID():kind==="other team"?f.seat.id:f.instructionSeat.id,name:kind==="unknown skill"?"missing":"verify"}),null);});
for(const kind of ["matching","unknown key","different version"])test(`backfill handles ${kind}`,t=>{const f=instructionsFixture(t);f.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(f.team.teamId);if(kind==="unknown key")f.raw.prepare("UPDATE teams SET pack_key='missing-team' WHERE id=?").run(f.team.teamId);if(kind==="different version")f.raw.prepare("UPDATE teams SET pack_version='2.0.0' WHERE id=?").run(f.team.teamId);backfillPackSnapshots(f.raw,[registryEntry(f.pack)],f.clock());assert.equal(f.raw.prepare("SELECT pack_digest FROM teams WHERE id=?").get(f.team.teamId).pack_digest,kind==="matching"?f.pack.digest:null);});
test("backfill logs a generic failure and does not throw",t=>{const f=instructionsFixture(t);const errors=[];t.mock.method(console,"error",message=>errors.push(message));f.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(f.team.teamId);f.raw.exec("CREATE TRIGGER reject_backfill BEFORE UPDATE ON teams BEGIN SELECT RAISE(ABORT,'private failure'); END");assert.doesNotThrow(()=>backfillPackSnapshots(f.raw,[registryEntry(f.pack)],f.clock()));assert.deepEqual(errors,["Instructions unavailable"]);});
test("migration nine creates strict snapshot and instruction tables",t=>{const f=instructionsFixture(t);for(const name of ["pack_snapshots","pack_files","attempt_instructions"])assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name=?").get(name).strict,1);assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map(x=>x.version),[1,2,3,4,5,6,7,8,9]);});
for(const digest of ["short","g".repeat(64),"a".repeat(63)])test(`snapshot rejects invalid digest format ${digest.length}`,t=>{const f=instructionsFixture(t);assert.throws(()=>f.raw.prepare("INSERT INTO pack_snapshots VALUES (?,'key','1.0.0','{}','now')").run(digest),/CHECK/);});
test("snapshot rejects malformed manifest JSON",t=>{const f=instructionsFixture(t);assert.throws(()=>f.raw.prepare("INSERT INTO pack_snapshots VALUES (?,'key','1.0.0','{','now')").run("b".repeat(64)),/CHECK/);});
test("snapshot files enforce digest foreign keys",t=>{const f=instructionsFixture(t);assert.throws(()=>f.raw.prepare("INSERT INTO pack_files VALUES (?,'x','profile',NULL,NULL,'text')").run("b".repeat(64)),/FOREIGN KEY/);});
test("snapshot files enforce kind and content limits",t=>{const f=instructionsFixture(t);for(const [kind,content]of [["other","x"],["profile","x".repeat(65537)]])assert.throws(()=>f.raw.prepare("INSERT INTO pack_files VALUES (?,'x',?,NULL,NULL,?)").run(f.pack.digest,kind,content),/CHECK/);});
test("migration from eight preserves data and adds nullable digest",t=>{const root=temp(t);for(const name of readdirSync(migrationsDir).filter(x=>/^000[1-8]_/.test(x)))cpSync(join(migrationsDir,name),join(root,name));const s=openStorage(":memory:");t.after(()=>s.close());s.migrate({migrationsDir:root,backupDir:null});s.raw.prepare("INSERT INTO teams VALUES ('old',1,'Old','Charter',NULL,NULL,'active')").run();assert.deepEqual(s.migrate({migrationsDir,backupDir:join(root,"backups")}).applied,[9]);assert.equal(s.raw.prepare("SELECT pack_digest FROM teams WHERE id='old'").get().pack_digest,null);assert.equal(s.raw.prepare("SELECT name FROM teams WHERE id='old'").get().name,"Old");assert.deepEqual(s.raw.prepare("PRAGMA foreign_key_check").all(),[]);});
test("Host startup backfills a matching legacy team",async t=>{
  const disk=diskPack(t);let host;const stateDir=temp(t,async()=>{await host?.close();});
  const storage=openStorage(join(stateDir,"host.db"));storage.migrate({migrationsDir,backupDir:null});const pack=disk.load();
  const team=ensureTeamFromPack(storage.raw,pack,{clock:()=>new Date("2026-11-08T00:00:00.000Z"),newId:randomUUID});
  storage.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(team.teamId);storage.close();
  host=await startHost({stateDir,packDir:disk.dir,packsDir:dirname(disk.dir),port:0,dispatch:null,onBootstrapToken(){}});
  assert.equal(host.storage.raw.prepare("SELECT pack_digest FROM teams WHERE id=?").get(team.teamId).pack_digest,pack.digest);
});
