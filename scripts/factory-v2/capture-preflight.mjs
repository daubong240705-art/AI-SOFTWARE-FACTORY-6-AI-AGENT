import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const installed = args.length === 1 && args[0] === "--installed";
assert(
  args.length === 0 || installed,
  "Use no options for baseline or --installed for the authorized V2 installation",
);
const git = (...argv) =>
  execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
const baseline = git("rev-parse", "cad247b");
assert.equal(
  git("rev-parse", "checkpoint/factory-v2-f1-01-20261106"),
  baseline,
);
if (installed)
  assert.equal(
    git("rev-parse", "checkpoint/factory-v2-f1-01-apply-20261106"),
    git("rev-parse", "15ffd0a"),
  );
const legacyRoots = git("ls-tree", "--name-only", baseline)
  .split("\n")
  .filter((path) => !["plan", "research", "scripts"].includes(path));
assert.equal(
  git("diff", "--name-only", baseline, "--", ...legacyRoots),
  "",
  "Protected source must remain unchanged",
);
const mounted =
  "/mnt/" + root[0].toLowerCase() + root.slice(2).replaceAll("\\", "/");
assert(
  /^[A-Z]:\\/i.test(root),
  "Capture wrapper requires the Windows checkout",
);
const key = process.env.NINE_ROUTER_API_KEY || "";
const run = (argv, input) => {
  const result = spawnSync(
    "wsl.exe",
    ["--distribution", "Ubuntu", "--exec", ...argv],
    {
      input,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || result.error)
    throw new Error("WSL probe/check failed; raw output suppressed");
  assert(
    !key || !result.stdout.includes(key),
    "Unexpected credential in output; report not saved",
  );
  return result.stdout;
};
const probe = JSON.parse(
  run(
    [
      "/usr/bin/python3",
      `${mounted}/scripts/factory-v2/preflight-linux.py`,
      "--key-stdin",
      ...(installed ? ["--runtime-root", "/home/lazy/factory-v2"] : []),
    ],
    key + "\n",
  ),
);
assert.equal(probe.schemaVersion, 1);
assert.equal(probe.ticket, "F1-01");
assert.equal(probe.scope.includes("no inference"), true);
const setupPlan = JSON.parse(
  run(["/usr/bin/python3", `${mounted}/scripts/factory-v2/setup-linux.py`], ""),
);
assert.equal(setupPlan.mode, "plan-only");
assert.equal(setupPlan.changesSystemConfiguration, false);
const runtimeVerification = installed
  ? JSON.parse(
      run(
        [
          "/usr/bin/python3",
          `${mounted}/scripts/factory-v2/verify-linux-runtime.py`,
        ],
        "",
      ),
    )
  : null;
if (installed) {
  assert.equal(probe.readiness.environmentPrerequisitesSatisfied, true);
  assert.equal(runtimeVerification.nodeHttps.caVerified, true);
  assert.equal(runtimeVerification.opencodeProtocol.healthy, true);
  assert.equal(runtimeVerification.ownedProcessExited, true);
}
const disk = JSON.parse(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-Volume -DriveLetter C,E | Select-Object DriveLetter,SizeRemaining,Size | ConvertTo-Json",
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
const sourceFiles = [
  "scripts/factory-v2/preflight-linux.py",
  "scripts/factory-v2/setup-linux.py",
  "scripts/factory-v2/linux-toolchain.lock.json",
  "scripts/factory-v2/capture-preflight.mjs",
  ...(installed ? ["scripts/factory-v2/verify-linux-runtime.py"] : []),
];
const report = {
  ...probe,
  ...(installed
    ? {
        scope:
          "Installed native Linux toolchain; GET provider probes and temporary authenticated runtime server; no model turn or V1 data access",
      }
    : {}),
  userFacingDate: "2026-11-06",
  baseline,
  checkpoint: "checkpoint/factory-v2-f1-01-20261106",
  ticketState: installed ? "done" : "in-progress",
  setup: {
    ...setupPlan,
    mode: installed ? "installed-and-verified" : setupPlan.mode,
    applied: installed,
    authorization: installed
      ? "User explicitly authorized /home/lazy/factory-v2; preserve V1 and existing credentials"
      : "Pending authorization for the new Linux workspace; no writes outside checkout",
  },
  ...(installed
    ? {
        runtimeVerification,
        applyBaseline: git("rev-parse", "15ffd0a"),
        applyCheckpoint: "checkpoint/factory-v2-f1-01-apply-20261106",
      }
    : {}),
  windowsBackingVolumes: disk,
  diskLimitNote:
    "WSL ext4 reports virtual VHD capacity, not physically available Windows backing disk space; VHD backing volume not conclusively mapped",
  validation: {
    legacySourceUnchanged: true,
    checkpointVerified: true,
  },
  sourceFiles: sourceFiles.map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n"))
      .digest("hex"),
  })),
  hashEncoding: "UTF-8 source normalized to LF",
};
for (const path of [
  "plan/factory-v2/f1-01-preflight.md",
  "scripts/factory-v2/README.md",
]) {
  const contents = readFileSync(resolve(root, path), "utf8");
  for (const match of contents.matchAll(/\]\((<[^>]+>|[^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:\/\//i.test(target)) continue;
    const output = resolve(root, dirname(path), target);
    assert(
      output === resolve(root, "research/factory-v2/f1-01-preflight.json") ||
        output === resolve(root, "research/factory-v2/f1-01-installed.json") ||
        existsSync(output),
      "Broken link",
    );
  }
}
writeFileSync(
  resolve(
    root,
    `research/factory-v2/f1-01-${installed ? "installed" : "preflight"}.json`,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      linux: report.linux,
      router: report.router,
      readiness: report.readiness,
      setup: report.setup,
      validation: report.validation,
      ...(installed ? { runtimeVerification } : {}),
    },
    null,
    2,
  ),
);
