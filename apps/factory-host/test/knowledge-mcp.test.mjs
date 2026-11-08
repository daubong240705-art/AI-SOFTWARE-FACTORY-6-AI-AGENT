import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { knowledgeGetInputSchema, knowledgeSearchInputSchema } from "@factory/contracts";
import { openStorage } from "../dist/storage/database.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { createKnowledgeMcp } from "../dist/knowledge/mcp.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const now = () => new Date("2026-11-08T00:00:00.000Z");
const rpc = (method, params = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const baseNames = ["task.progress", "output.register", "decision.request"];
const names = [...baseNames, "knowledge.search", "knowledge.get"];
const error = (result, message) => assert.deepEqual(result, { isError: true, content: [{ type: "text", text: message }] });
const data = (result) => { assert.equal(result.isError, false); return JSON.parse(result.content[0].text); };

function fixture(t, transport, enabled = true) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const projectId = randomUUID(); const otherProject = randomUUID(); const taskId = randomUUID();
  const teams = [randomUUID(), randomUUID()]; const seats = teams.map(() => randomUUID()); const attempts = teams.map(() => randomUUID());
  const otherTask = randomUUID();
  for (const project of [projectId, otherProject]) {
    raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(project);
    raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
      VALUES (?,?,1,'KN-001','Task','Goal','Brief','operator','active','[]','[]','[]')`).run(project, taskId);
  }
  raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,'KN-002','Task','Goal','Brief','operator','active','[]','[]','[]')`).run(projectId,otherTask);
  raw.prepare("INSERT INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('local',1,'Local','linux','trusted-workstation','online',2,0)").run();
  for (let i = 0; i < 2; i++) {
    raw.prepare("INSERT INTO teams VALUES (?,1,'Team','Charter',NULL,NULL,'active')").run(teams[i]);
    raw.prepare("INSERT INTO seats VALUES (?,?,1,'Seat','Writer','profile',1,'fake',1,'elastic',NULL,0)").run(seats[i], teams[i]);
    raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,node_id,lease_id,lease_expires_at)
      VALUES (?,?,?,1,?,'running','known','fake','fake','fake','medium','local',?,'2026-11-08T01:00:00.000Z')`)
      .run(projectId, attempts[i], i === 0 ? taskId : otherTask, i + 1,randomUUID());
    raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(projectId, attempts[i], seats[i]);
  }
  const objects = new Map(); let reads = 0; let searches = 0; let gets = 0; let upstreamCalls = 0;
  const store = {
    put(input) { const bytes = Buffer.from(input); const hash = createHash("sha256").update(bytes).digest("hex"); objects.set(hash, bytes); return { hash, size: bytes.length }; },
    get(hash) { reads++; return objects.get(hash) ?? null; },
  };
  const index = createKnowledgeIndex({ raw, store });
  const knowledge = createKnowledgeMcp({ raw, now, knowledge: { ...index,
    search(...args) { searches++; return index.search(...args); }, get(...args) { gets++; return index.get(...args); },
  } });
  const handler = createMcpHandler({ progress() {}, registerOutput() { return { artifactId: randomUUID(), version: 1 }; },
    requestDecision() { return { approvalId: randomUUID() }; }, ...(enabled ? { knowledge } : {}) });
  const tokens = createTokenRegistry({ clock: now });
  const input = { projectId, taskId, attemptId: attempts[0], epoch: 1, allowedModels: ["approved"] };
  const token = tokens.issue(input).token; const grant = tokens.resolve(token);
  const proxy = transport === "proxy" ? createModelProxy({ raw, tokens, clock: now, newId: randomUUID,
    budget: DEFAULT_BUDGET_CONFIG, allowedHosts: ["127.0.0.1:18787"], mcp: handler,
    upstream: { providerId: "fixture", async chatCompletions() { upstreamCalls++; throw new Error("unused"); } },
  }) : null;
  t.after(async () => { await proxy?.close(); tokens.revokeAll(); storage.close(); });
  const send = async (method, params = {}, selectedGrant = grant) => {
    let response;
    if (proxy) {
      const selectedToken = selectedGrant === grant ? token : tokens.issue(selectedGrant).token;
      const reply = await proxy.app.inject({ method: "POST", url: "/mcp", payload: rpc(method, params),
        headers: { host: "127.0.0.1:18787", authorization: `Bearer ${selectedToken}`, "content-type": "application/json" } });
      assert.equal(reply.statusCode, 200); response = reply.json();
    } else response = handler.handle(selectedGrant, rpc(method, params)).body;
    const serialized = JSON.stringify(response);
    assert.equal(serialized.includes(token), false); assert.doesNotMatch(serialized, /SELECT |SQLITE_|contentHash|content_hash/);
    assert.ok(Buffer.byteLength(serialized) <= 65536); assert.equal(upstreamCalls, 0);
    assert.ok(response.result); return response.result;
  };
  const call = (name, args, selectedGrant) => send("tools/call", { name, arguments: args }, selectedGrant);
  const add = (extra = {}) => {
    const row = { projectId, artifactId: randomUUID(), version: 1, kind: "requirements", title: "Knowledge marker",
      status: "draft", visibility: "project", producer: attempts[0], abstractL0: "Short abstract", abstractL1: "Detailed abstract",
      mediaType: "text/markdown", body: "Readable body", ...extra };
    const content = store.put(row.body);
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
      abstract_l0,abstract_l1,produced_by_attempt_id,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.projectId,row.artifactId,row.version,row.kind,row.title,row.mediaType,content.hash,content.size,row.status,
        row.abstractL0,row.abstractL1,row.projectId === projectId ? row.producer : null,row.visibility,now().toISOString());
    index.indexVersion(row.projectId,row.artifactId,row.version); return row;
  };
  return { raw, projectId, otherProject, taskId, otherTask, teams, seats, attempts, grant, add, call, send, objects, store, index,
    counts: () => ({ reads, searches, gets }) };
}

for (const transport of ["handler", "proxy"]) {
  test(`${transport} lists strict knowledge schemas when enabled`, async (t) => {
    const f = fixture(t, transport); const list = (await f.send("tools/list")).tools;
    assert.deepEqual(list.map((tool) => tool.name), names);
    for (const [name, schema] of [["knowledge.search",knowledgeSearchInputSchema],["knowledge.get",knowledgeGetInputSchema]]) {
      const tool = list.find((entry) => entry.name === name);
      assert.equal(tool.inputSchema.additionalProperties, false); assert.deepEqual(tool.inputSchema, z.toJSONSchema(schema));
    }
  });
  test(`${transport} hides and refuses optional tools without a dependency`, async (t) => {
    const f = fixture(t, transport, false); assert.deepEqual((await f.send("tools/list")).tools.map((tool) => tool.name), baseNames);
    for (const name of ["knowledge.search", "knowledge.get"]) error(await f.call(name, {}), "tool is not available");
  });
  for (const [query, title] of [["thiet ke","Thiết kế"],["dang nhap","Đăng nhập"]])
    test(`${transport} finds Vietnamese query ${query}`, async (t) => {
      const f = fixture(t, transport); const row = f.add({ title }); const result = data(await f.call("knowledge.search", { query }));
      assert.equal(result.truncated, false); assert.deepEqual(result.results.map((item) => item.artifactId), [row.artifactId]);
      assert.equal(result.results[0].title, title);
    });
  test(`${transport} combines filters before pagination`, async (t) => {
    const f = fixture(t, transport); f.add({kind:"plan"}); const row = f.add({status:"approved"}); f.add({status:"reviewed"});
    const result = data(await f.call("knowledge.search", {query:"marker", kinds:["requirements"], statuses:["approved"], limit:1}));
    assert.deepEqual(result.results.map((item) => item.artifactId),[row.artifactId]); assert.equal(result.truncated,false);
  });
  test(`${transport} paginates with a truthful truncated flag`, async (t) => {
    const f = fixture(t, transport); for(let i=0;i<4;i++) f.add();
    const first = data(await f.call("knowledge.search", {query:"marker",limit:2}));
    const last = data(await f.call("knowledge.search", {query:"marker",limit:2,offset:2}));
    assert.equal(first.truncated,true); assert.equal(last.truncated,false);
    assert.equal(new Set([...first.results,...last.results].map((row)=>row.artifactId)).size,4);
    assert.deepEqual(data(await f.call("knowledge.search",{query:"marker",offset:4})),{results:[],truncated:false});
  });
  test(`${transport} defaults to ten results and honors the maximum page`, async (t) => {
    const f = fixture(t, transport); for(let i=0;i<21;i++) f.add();
    const defaults=data(await f.call("knowledge.search",{query:"marker"})); assert.equal(defaults.results.length,10); assert.equal(defaults.truncated,true);
    const maximum=data(await f.call("knowledge.search",{query:"marker",limit:20})); assert.equal(maximum.results.length,20); assert.equal(maximum.truncated,true);
  });
  for (const level of ["l0","l1","l2"]) test(`${transport} reads ${level}`, async (t) => {
    const f=fixture(t,transport); const row=f.add(); const doc=data(await f.call("knowledge.get",{artifactId:row.artifactId,level}));
    assert.equal(doc.text,level==="l0"?row.abstractL0:level==="l1"?row.abstractL1:row.body);
    assert.equal(doc.level,level); assert.equal(doc.truncated,false); assert.equal(doc.sizeBytes,Buffer.byteLength(row.body));
  });
  test(`${transport} prefers newest visible approved version over newer drafts`, async (t) => {
    const f=fixture(t,transport); const row=f.add({status:"approved"});
    f.add({artifactId:row.artifactId,version:2,status:"approved"}); f.add({artifactId:row.artifactId,version:3});
    assert.equal(data(await f.call("knowledge.get",{artifactId:row.artifactId})).version,2);
    assert.equal(data(await f.call("knowledge.get",{artifactId:row.artifactId,version:3})).version,3);
  });
  test(`${transport} defaults to newest visible version without approval`, async (t) => {
    const f=fixture(t,transport); const row=f.add({abstractL1:null});
    assert.equal(data(await f.call("knowledge.get",{artifactId:row.artifactId})).text,row.abstractL0);
    f.add({artifactId:row.artifactId,version:2,status:"reviewed"});
    f.add({artifactId:row.artifactId,version:3,visibility:"team-draft",producer:f.attempts[1]});
    assert.equal(data(await f.call("knowledge.get",{artifactId:row.artifactId})).version,2);
    assert.equal(data(await f.call("knowledge.search",{query:"marker"})).results[0].version,2);
  });
  for(const mediaType of ["text/x-diff","image/png","application/pdf"]) test(`${transport} refuses full text for ${mediaType}`,async(t)=>{
    const f=fixture(t,transport); const row=f.add({mediaType}); const before=f.counts().reads;
    error(await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"}),"content is not readable as text");
    assert.equal(f.counts().reads,before); assert.equal(data(await f.call("knowledge.get",{artifactId:row.artifactId,level:"l0"})).text,row.abstractL0);
  });
  test(`${transport} truncates full text at a UTF8 boundary and reports real size`,async(t)=>{
    const f=fixture(t,transport); const body="a\n\tb\u0000"+"Đ".repeat(20000); const row=f.add({body});
    const doc=data(await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"}));
    assert.equal(doc.truncated,true); assert.equal(doc.sizeBytes,Buffer.byteLength(body)); assert.ok(Buffer.byteLength(doc.text)<=32768);
    assert.ok(doc.text.startsWith("a\n\tb ")); assert.equal(doc.text.includes("�"),false);
  });
  test(`${transport} derives the team from the current database seat`,async(t)=>{
    const f=fixture(t,transport); const own=f.add({visibility:"team-draft",producer:f.attempts[1]});
    error(await f.call("knowledge.get",{artifactId:own.artifactId}),"not found");
    f.raw.prepare("UPDATE attempt_seats SET seat_id=? WHERE attempt_id=?").run(f.seats[1],f.grant.attemptId);
    assert.equal(data(await f.call("knowledge.get",{artifactId:own.artifactId})).artifactId,own.artifactId);
  });
  test(`${transport} conceals another team's draft exactly like an absent artifact`,async(t)=>{
    const f=fixture(t,transport); const row=f.add({visibility:"team-draft",producer:f.attempts[1]}); const before=f.counts().reads;
    const hidden=await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"});
    assert.deepEqual(hidden,await f.call("knowledge.get",{artifactId:randomUUID(),level:"l2"})); error(hidden,"not found");
    assert.deepEqual(data(await f.call("knowledge.search",{query:"marker"})),{results:[],truncated:false}); assert.equal(f.counts().reads,before);
  });
  for(const [visibility,status,visible] of [["project","approved",false],["team-draft","draft",false],["organization","draft",false],["organization","approved",true]])
    test(`${transport} enforces cross project ${visibility} ${status}`,async(t)=>{
      const f=fixture(t,transport); const row=f.add({projectId:f.otherProject,visibility,status}); const before=f.counts().reads;
      const search=data(await f.call("knowledge.search",{query:"marker"})); assert.equal(search.results.length,visible?1:0);
      const result=await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"});
      if(visible) { assert.equal(data(result).visibility,"shared"); assert.equal(search.results[0].artifactId,row.artifactId); }
      else { error(result,"not found"); assert.equal(JSON.stringify([search,result]).includes(f.otherProject),false); assert.equal(f.counts().reads,before); }
      assert.equal(JSON.stringify([search,result]).includes(f.otherProject),false);
    });
  test(`${transport} hidden best matches do not consume pagination`,async(t)=>{
    const f=fixture(t,transport); for(let i=0;i<3;i++) f.add();
    for(let i=0;i<5;i++) f.add({title:"marker marker marker",visibility:"team-draft",producer:f.attempts[1]});
    const page=data(await f.call("knowledge.search",{query:"marker",limit:2,offset:1})); assert.equal(page.results.length,2); assert.equal(page.truncated,false);
  });
  for(const state of ["queued","preparing","succeeded","failed","stopped","waiting-input"]) test(`${transport} fences ${state} before any knowledge read`,async(t)=>{
    const f=fixture(t,transport); const row=f.add();
    f.raw.prepare(`UPDATE attempts SET state=?,ended_at=? ${state==="queued"?",node_id=NULL,lease_id=NULL":""} WHERE id=?`).run(state,now().toISOString(),f.grant.attemptId);
    const before=f.counts(); error(await f.call("knowledge.search",{query:"marker"}),"attempt is not active");
    error(await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"}),"attempt is not active"); assert.deepEqual(f.counts(),before);
  });
  for(const fence of ["epoch","expired lease","missing lease"]) test(`${transport} fences ${fence}`,async(t)=>{
    const f=fixture(t,transport); const row=f.add();
    if(fence!=="epoch") f.raw.prepare(`UPDATE attempts SET ${fence==="missing lease"?"state='queued',node_id=NULL,lease_id=NULL":"lease_expires_at='2026-11-07T00:00:00.000Z'"} WHERE id=?`).run(f.grant.attemptId);
    const before=f.counts(); error(await f.call("knowledge.get",{artifactId:row.artifactId},fence==="epoch"?{...f.grant,epoch:3}:f.grant),"attempt is not active"); assert.deepEqual(f.counts(),before);
  });
  test(`${transport} caps combined reads per attempt at two hundred`,async(t)=>{
    const f=fixture(t,transport); const row=f.add();
    for(let i=0;i<200;i++) assert.equal((await f.call(i%2?"knowledge.get":"knowledge.search",i%2?{artifactId:row.artifactId}:{query:"marker"})).isError,false);
    const before=f.counts(); error(await f.call("knowledge.search",{query:"marker"}),"tool limit reached");
    error(await f.call("knowledge.get",{artifactId:row.artifactId}),"tool limit reached"); assert.deepEqual(f.counts(),before);
    const other={...f.grant,taskId:f.otherTask,attemptId:f.attempts[1],epoch:2}; assert.equal((await f.call("knowledge.search",{query:"marker"},other)).isError,false);
  });
  for(const field of ["title","abstractL0","abstractL1"]) test(`${transport} sanitizes metadata field ${field}`,async(t)=>{
    const f=fixture(t,transport); const row=f.add({[field]:"marker /private/fixture C:\\private\\fixture fpx_synthetic_value\u0000\u202e"});
    const search=data(await f.call("knowledge.search",{query:"marker"})); const doc=data(await f.call("knowledge.get",{artifactId:row.artifactId}));
    const response=JSON.stringify([search,doc]); assert.doesNotMatch(response,/private|fpx_|\\u0000|\u202e/); assert.match(response,/\[path\]/); assert.match(response,/\[redacted\]/);
  });
  for(const failure of ["missing content","invalid encoding","incorrect size"]) test(`${transport} uses fixed errors for ${failure}`,async(t)=>{
    const f=fixture(t,transport); const row=f.add({body:failure==="invalid encoding"?Buffer.from([255]):"body"});
    if(failure==="missing content") f.objects.clear();
    if(failure==="incorrect size") for(const key of f.objects.keys()) f.objects.set(key,Buffer.from("different size"));
    error(await f.call("knowledge.get",{artifactId:row.artifactId,level:"l2"}),"not found");
  });
  test(`${transport} hides database errors behind a fixed short message`,async(t)=>{
    const f=fixture(t,transport); f.raw.exec("DROP TABLE knowledge_index");
    error(await f.call("knowledge.search",{query:"marker"}),"search is temporarily unavailable");
  });
  for(const [label,args] of [
    ["missing query",{}],["empty query",{query:""}],["long query",{query:"x".repeat(201)}],["numeric query",{query:1}],
    ["bad kind",{query:"marker",kinds:["invalid"]}],["bad status",{query:"marker",statuses:["invalid"]}],
    ["small limit",{query:"marker",limit:0}],["large limit",{query:"marker",limit:21}],["fractional limit",{query:"marker",limit:1.5}],
    ["negative offset",{query:"marker",offset:-1}],["large offset",{query:"marker",offset:201}],
    ["extra team",{query:"marker",teamId:randomUUID()}],["extra project",{query:"marker",projectId:randomUUID()}],
    ["too many kinds",{query:"marker",kinds:Array(6).fill("plan")}],["too many statuses",{query:"marker",statuses:Array(6).fill("draft")}],
  ]) test(`${transport} refuses search input ${label}`,async(t)=>{
    const f=fixture(t,transport); const before=f.counts(); error(await f.call("knowledge.search",args),"invalid tool input"); assert.deepEqual(f.counts(),before);
  });
  for(const [label,args] of [["missing identifier",{}],["invalid identifier",{artifactId:"invalid"}],
    ["zero version",{artifactId:randomUUID(),version:0}],["fractional version",{artifactId:randomUUID(),version:1.5}],
    ["invalid level",{artifactId:randomUUID(),level:"l3"}],["extra team",{artifactId:randomUUID(),teamId:randomUUID()}]])
    test(`${transport} refuses get input ${label}`,async(t)=>{
      const f=fixture(t,transport); const before=f.counts(); error(await f.call("knowledge.get",args),"invalid tool input"); assert.deepEqual(f.counts(),before);
    });
  for(const query of ["' OR 1=1 --","NEAR(marker body)","title:marker","\"unfinished","***"])
    test(`${transport} handles literal query ${query.replace(/[^a-z]/gi,"")||"punctuation"}`,async(t)=>{
      const f=fixture(t,transport); f.add({projectId:f.otherProject,title:"Other private marker"});
      const result=data(await f.call("knowledge.search",{query})); assert.deepEqual(result,{results:[],truncated:false});
      assert.equal(JSON.stringify(result).includes(f.otherProject),false);
    });
}


for(const transport of ["handler","proxy"]) for(const hidden of [false,true]) test(`${transport} stale flags preserve hidden because-artifact privacy ${hidden}`,async(t)=>{
  const f=fixture(t,transport); const row=f.add(); const cause=f.add({visibility:hidden?"team-draft":"project",producer:f.attempts[1]});
  f.raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,1,?,1,?)").run(f.projectId,row.artifactId,cause.artifactId,now().toISOString());
  const get=data(await f.call("knowledge.get",{artifactId:row.artifactId,version:1,level:"l0"})); assert.equal(get.stale,true);
  const results=data(await f.call("knowledge.search",{query:"marker"})).results;
  assert.equal(results.find(r=>r.artifactId===row.artifactId).stale,true);
  assert.equal(JSON.stringify(get).includes(cause.artifactId),false); assert.equal("becauseArtifactId" in get,false);
  if(hidden) assert.equal(results.some(r=>r.artifactId===cause.artifactId),false);
});
for(const tool of ["knowledge.search","knowledge.get"]) test(`${tool} returns false for fresh knowledge`,async(t)=>{
  const f=fixture(t,"handler"); const row=f.add();
  const result=data(await f.call(tool,tool==="knowledge.get"?{artifactId:row.artifactId}:{query:"marker"}));
  assert.equal(tool==="knowledge.get"?result.stale:result.results[0].stale,false);
});
