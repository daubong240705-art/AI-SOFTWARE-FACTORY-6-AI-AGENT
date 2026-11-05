// Repository inventory only. Never import the app, open SQLite or execute project scripts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...args) =>
  execFileSync("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 });
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const jsonHash = (data) => sha256(JSON.stringify(JSON.parse(data.toString())));
const options = { baseline: "HEAD", localMetadata: false, output: null };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--local-data-metadata") options.localMetadata = true;
  else if (["--baseline", "--output"].includes(args[i])) {
    const key = args[i] === "--baseline" ? "baseline" : "output";
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw Error(`Missing value for ${key}`);
    options[key] = value;
  } else throw Error(`Unknown option: ${args[i]}`);
}
const commit = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${options.baseline}^{commit}`,
)
  .toString()
  .trim();
const map = JSON.parse(
  readFileSync(join(root, "research/factory-v2/reuse-map.json"), "utf8"),
);
const ids = new Set();
const references = new Set();
const decisionCounts = {};
for (const module of map.modules) {
  if (ids.has(module.id) || !Object.hasOwn(map.decisions, module.decision))
    throw Error(`Invalid module: ${module.id}`);
  ids.add(module.id);
  decisionCounts[module.decision] = (decisionCounts[module.decision] ?? 0) + 1;
  for (const path of [...module.files, ...module.tests]) {
    if (
      !path.startsWith("apps/windows-worker/") ||
      path.split("/").includes("..")
    )
      throw Error(`Invalid reference: ${path}`);
    references.add(path);
  }
}
const referenceFiles = [...references].sort().map((path) => {
  const data = git("show", `${commit}:${path}`);
  return { path, bytes: data.length, sha256: sha256(data) };
});
const tracked = git(
  "ls-tree",
  "-r",
  "--full-tree",
  commit,
  "--",
  "apps/windows-worker/",
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);
const packageJson = JSON.parse(
  git("show", `${commit}:apps/windows-worker/package.json`).toString(),
);
const databaseSource = git(
  "show",
  `${commit}:apps/windows-worker/electron/storage/database.ts`,
).toString();
const schemaMaximum = databaseSource.match(/if\s*\(version\s*>\s*(\d+)\)/)?.[1];
if (!schemaMaximum)
  throw Error("Cannot identify source schema maximum at selected revision");
const status = git("status", "--porcelain=v1", "-z", "--untracked-files=normal")
  .toString()
  .split("\0")
  .filter(Boolean);
const snapshot = {
  schemaVersion: 1,
  recordedAtUtc: new Date().toISOString(),
  reviewDate: map.reviewDate,
  scope:
    "F0-01 static source inventory; not application or database acceptance",
  baselineCommit: commit,
  branch: git("branch", "--show-current").toString().trim(),
  nodeVersion: process.version,
  workerVersion: packageJson.version,
  legacyTrackedFileCount: tracked.length,
  legacyGitTreeSha256: sha256(tracked.join("\n") + "\n"),
  sourceSchemaMaximum: Number(schemaMaximum),
  schemaEvidence:
    "apps/windows-worker/electron/storage/database.ts; source only, database not opened",
  worktreeStatusAtCapture: status,
  reuseMap: {
    path: "research/factory-v2/reuse-map.json",
    jsonSha256: jsonHash(
      readFileSync(join(root, "research/factory-v2/reuse-map.json")),
    ),
    moduleCount: ids.size,
    decisionCounts,
  },
  referenceFiles,
  legacyData: {
    pathTemplate: "%APPDATA%/ASF Windows Worker",
    inspected: false,
    databaseOpened: false,
    schemaReadFromDatabase: false,
  },
  effects: {
    projectCodeExecuted: false,
    databaseOpened: false,
    credentialsRead: false,
    wslStarted: false,
    modelCalled: false,
  },
};
if (options.localMetadata) {
  if (process.platform !== "win32" || !process.env.APPDATA)
    throw Error("Local data metadata requires Windows APPDATA");
  const dataDirectory = join(process.env.APPDATA, "ASF Windows Worker");
  const metadata = (name) => {
    try {
      const stat = statSync(join(dataDirectory, name));
      return {
        name,
        exists: true,
        kind: stat.isDirectory() ? "directory" : "file",
        bytes: stat.isFile() ? stat.size : null,
        modifiedAtUtc: stat.mtime.toISOString(),
      };
    } catch (error) {
      if (error.code === "ENOENT") return { name, exists: false };
      throw error;
    }
  };
  snapshot.legacyData.inspected = true;
  snapshot.legacyData.metadataOnly = [
    "worker.sqlite",
    "worker.sqlite-wal",
    "worker.sqlite-shm",
    "owned-jobs",
    "runtime",
    "workspaces",
  ].map(metadata);
}
const json = JSON.stringify(snapshot, null, 2) + "\n";
if (options.output) {
  const target = resolve(root, options.output);
  const rel = relative(root, target);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel) ||
    !rel.endsWith(".json")
  )
    throw Error("Output must be a new JSON file within this repository");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json, { encoding: "utf8", flag: "wx" });
  process.stdout.write(
    `Inventory saved: ${rel}; ${ids.size} modules, ${referenceFiles.length} source/test references, ${tracked.length} legacy files\n`,
  );
} else process.stdout.write(json);
