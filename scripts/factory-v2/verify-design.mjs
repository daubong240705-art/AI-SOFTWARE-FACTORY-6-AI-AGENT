import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const design = "design/factory-v2/";
const docs = [
  "design/factory-v2/README.md",
  "plan/factory-v2/f0-02-design-baseline.md",
  "plan/factory-v2/README.md",
  "plan/factory-v2/design-reference.md",
  "plan/factory-v2/delivery-plan.md",
  "plan/factory-v2/uiux-upgrade.md",
  "plan/factory-v2/acceptance.md",
  "scripts/factory-v2/README.md",
];
let checkedLinks = 0;
for (const path of docs) {
  for (const match of read(path).matchAll(/\]\((<[^>]+>|[^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:\/\//i.test(target)) continue;
    assert(
      existsSync(resolve(root, dirname(path), decodeURIComponent(target))),
      "Broken local link: " + path + " -> " + target,
    );
    checkedLinks++;
  }
}
const tokens = json(design + "tokens.json"),
  vi = json(design + "labels.vi.json"),
  en = json(design + "labels.en.json"),
  seed = json(design + "seed.json"),
  screens = json(design + "screens.json"),
  components = json(design + "components.json");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const flatten = (object, prefix = "") =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      value && typeof value === "object"
        ? Object.entries(flatten(value, prefix + key + "."))
        : [[prefix + key, value]],
    ),
  );
const resourceA = flatten(vi),
  resourceB = flatten(en);
assert.deepEqual(Object.keys(resourceA).sort(), Object.keys(resourceB).sort());
for (const key of Object.keys(resourceA)) {
  if (typeof resourceA[key] !== "string") continue;
  const vars = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    vars(resourceA[key]),
    vars(resourceB[key]),
    "Translation placeholders: " + key,
  );
}
const lum = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((n) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
    .reduce((a, n, i) => a + n * [0.2126, 0.7152, 0.0722][i], 0);
const contrasts = [];
assert.deepEqual(
  Object.keys(tokens.themes.light).sort(),
  Object.keys(tokens.themes.dark).sort(),
);
for (const [theme, colors] of Object.entries(tokens.themes))
  for (const pair of tokens.contrastPairs) {
    const a = lum(colors[pair.foreground]),
      b = lum(colors[pair.background]),
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert(
      ratio >= pair.minimum,
      `${theme}: ${pair.foreground}/${pair.background} contrast ${ratio}`,
    );
    contrasts.push({ theme, ...pair, ratio: Number(ratio.toFixed(3)) });
  }
const unique = (items) => {
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  return new Set(ids);
};
const agentIds = unique(seed.agents),
  taskIds = unique(seed.tasks),
  documentIds = unique(seed.documents),
  scenarioIds = unique(seed.scenarios),
  componentIds = unique(components.components);
unique(seed.projects);
unique(seed.decisions);
unique(seed.messages);
unique(seed.activity);
unique(screens.screens);
assert.equal(seed.fixtureOnly, true);
for (const task of seed.tasks) {
  if (task.ownerId) assert(agentIds.has(task.ownerId));
  for (const ref of task.dependencies) assert(taskIds.has(ref));
  for (const ref of task.inputRefs) assert(documentIds.has(ref));
  assert(task.criteria.length && task.output);
}
for (const agent of seed.agents) {
  if (agent.taskId) assert(taskIds.has(agent.taskId));
  if (agent.parentId) assert(agentIds.has(agent.parentId));
}
for (const doc of seed.documents) {
  assert(taskIds.has(doc.taskId) && agentIds.has(doc.authorId));
}
for (const decision of seed.decisions) assert(taskIds.has(decision.taskId));
for (const project of seed.projects) assert(agentIds.has(project.leadId));
for (const event of seed.activity)
  assert(agentIds.has(event.actorId) && taskIds.has(event.taskId));
const done = new Set(),
  visiting = new Set();
function visit(id) {
  assert(!visiting.has(id), "Dependency cycle: " + id);
  if (done.has(id)) return;
  visiting.add(id);
  for (const dep of seed.tasks.find((t) => t.id === id).dependencies)
    visit(dep);
  visiting.delete(id);
  done.add(id);
}
seed.tasks.forEach((task) => visit(task.id));
const fe = seed.tasks.find((t) => t.id === "fs-10"),
  be = seed.tasks.find((t) => t.id === "fs-11");
assert.deepEqual(fe.inputRefs, be.inputRefs);
assert(!fe.dependencies.includes(be.id) && !be.dependencies.includes(fe.id));
assert(components.viewStates.every((id) => scenarioIds.has(id)));
assert.equal(
  Object.values(screens.rubric).reduce((a, b) => a + b, 0),
  100,
);
assert.equal(screens.targets.measured, false);
assert.equal(screens.targets.historicalVisualTargets.releaseGate, false);
const manifest = json("research/factory-v2/reference-manifest.json");
assert.equal(screens.screens.length, 9);
const references = [];
for (const screen of screens.screens) {
  const reference = manifest.screenshots.find(
    (ref) => ref.id === screen.referenceId,
  );
  assert(reference);
  for (const id of screen.components) assert(componentIds.has(id));
  for (const id of screen.scenarios) assert(scenarioIds.has(id));
  const path = resolve(root, reference.path);
  // Reference images stay local; a checkout without them can still verify portable source.
  if (!existsSync(path)) {
    references.push({ id: screen.id, status: "missing-local-reference" });
    continue;
  }
  const bytes = readFileSync(path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    reference.sha256,
  );
  assert.equal(bytes.readUInt32BE(16), reference.width);
  assert.equal(bytes.readUInt32BE(20), reference.height);
  assert.equal(git("ls-files", "--", reference.path), "");
  references.push({ id: screen.id, status: "hash-and-dimensions-verified" });
}
const fontManifest = json(design + "assets/font-manifest.json");
for (const file of fontManifest.files) {
  const bytes = readFileSync(resolve(root, file.path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  assert.equal(bytes.length, file.bytes);
}
const font = json(".cache/factory-v2/font-validation.json");
assert.equal(font.missingCodepoints.length, 0);
assert.equal(
  font.sha256,
  fontManifest.files.find((f) => f.path.endsWith(".woff2")).sha256,
);
const html = read(".cache/factory-v2/style-guide/index.html");
assert(html.includes("data:font/woff2;base64,"));
assert(!/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["']https?:/i.test(html));
assert(!/@import|url\(["']?https?:/i.test(html));
const css = read(design + "style-guide.css"),
  knownVars = new Set(
    [
      ...read(".cache/factory-v2/style-guide/tokens.css").matchAll(
        /(--[\w-]+)\s*:/g,
      ),
    ].map((m) => m[1]),
  );
for (const match of css.matchAll(/var\((--[\w-]+)/g))
  assert(knownVars.has(match[1]), "Unknown CSS token " + match[1]);
const preview = read(design + "preview.mjs");
assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(preview));
const syntaxFiles = [
  design + "preview.mjs",
  design + "window-state.mjs",
  "scripts/factory-v2/build-style-guide.mjs",
  "scripts/factory-v2/verify-design.mjs",
];
for (const path of syntaxFiles)
  execFileSync(process.execPath, ["--check", resolve(root, path)]);
const baseline = git("rev-parse", "946872e");
const legacyChanges = git(
  "diff",
  "--name-only",
  baseline,
  "--",
  "apps",
  "packages",
)
  .split("\n")
  .filter((path) => path && !path.startsWith("packages/factory-contracts/"));
assert.equal(
  legacyChanges.join("\n"),
  "",
  "Legacy apps/packages must remain unchanged; only the new V2 contracts package is allowed",
);
assert.equal(git("rev-parse", "checkpoint/factory-v2-ux0-20261106"), baseline);
const report = {
  schemaVersion: 1,
  userFacingDate: "2026-11-06",
  ticket: "F0-02",
  baseline,
  checkpoint: "checkpoint/factory-v2-ux0-20261106",
  scope: "Design baseline and offline fixture only",
  counts: {
    screens: 9,
    components: components.components.length,
    viewStates: components.viewStates.length,
    scenarios: seed.scenarios.length,
    agents: seed.agents.length,
    tasks: seed.tasks.length,
    translationLeaves: Object.keys(resourceA).length,
    contrastPairs: contrasts.length,
    renderCombinations: 192,
    checkedLocalDocLinks: checkedLinks,
  },
  checks: {
    json: true,
    resourceAndPlaceholderParity: true,
    themeTokenParity: true,
    cssVariablesDefined: true,
    seedReferencesAndAcyclicDependencies: true,
    sameBaInputsForParallelFeBe: true,
    fontAssetHashes: true,
    fontCmap: true,
    syntax: true,
    offlineBundleNoRemoteAssets: true,
    noRuntimeNetworkClients: true,
    trackedV1Unchanged: true,
  },
  font,
  contrasts,
  references,
  visual: {
    browserVerified: false,
    scoreMeasured: false,
    reason:
      "Computer Use verification previously stopped by URL-confidence guard. Code/geometry smoke tests are not browser layout, accessibility or pointer tests.",
  },
  notRun: [
    "Host/runtime/model/DB integration",
    "application build/typecheck",
    "browser layout/focus/pointer QA and performance measurements",
    "full production primitives/shadcn/react-rnd/i18next integration",
  ],
  limitations: [
    "Six fixed sample agents, one window per agent; not production conversation registry.",
    "Drafts/messages are in-memory only; layout/theme/locale persist in browser storage.",
    "Menus use disclosure prototype and browser title hints, not complete production accessible primitives.",
    "Only Board/Dashboard/Team/attention/settings/guide are fixture views; remaining reference screens are checklists.",
    "Inter normal variable font bundled; italic is not included.",
  ],
};
writeFileSync(
  resolve(root, "research/factory-v2/f0-02-validation.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);
console.log(
  JSON.stringify(
    { counts: report.counts, checks: report.checks, visual: report.visual },
    null,
    2,
  ),
);
