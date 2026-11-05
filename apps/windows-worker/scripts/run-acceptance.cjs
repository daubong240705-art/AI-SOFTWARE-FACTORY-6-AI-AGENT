const { spawn } = require("node:child_process");
const { join } = require("node:path");

// Explicit allowlist: a typo must never fall through to a live model run.
const scenarios = new Map([
  ["settings-ui", "acceptance-settings-ui.cjs"],
  ["workspace-summary-ui", "acceptance-workspace-summary-ui.cjs"],
  ["lead-access-ui", "acceptance-lead-access-ui.cjs"],
  ["work-detail-ui", "acceptance-work-detail-ui.cjs"],
  ["workspace-shell-ui", "acceptance-workspace-shell-ui.cjs"],
  ["mermaid-ui", "acceptance-mermaid-ui.cjs"],
  ["images-ui", "acceptance-images-ui.cjs"],
  ["git-ui", "acceptance-git-ui.cjs"],
  ["ux06-ui", "acceptance-ux06-ui.cjs"],
  ["board-ui", "acceptance-work-items-ui.cjs"],
  ["reports-ui", "acceptance-reports-ui.cjs"],
  ["questions-ui", "acceptance-questions-ui.cjs"],
  ["chat-context-live", "acceptance-chat-context-live.cjs"],
  ["chat-host-ui", "acceptance-chat-host-ui.cjs"],
  ["overview-ui", "acceptance-overview-ui.cjs"],
  ["ui-foundation", "acceptance-ui-foundation.cjs"],
  ["office-selection-ui", "acceptance-office-selection-ui.cjs"],
  ["office-state-ui", "acceptance-office-state-ui.cjs"],
  ["office-ui", "acceptance-office-ui.cjs"],
  ["inspector-ui", "acceptance-inspector-ui.cjs"],
  ["parallel-ui", "acceptance-parallel-ui.cjs"],
  ["parallel-live", "acceptance-parallel-live.cjs"],
  ["workspaces-ui", "acceptance-workspaces-ui.cjs"],
  ["lifecycle-live", "acceptance-lifecycle-live.cjs"],
  ["lifecycle-ui", "acceptance-lifecycle-ui.cjs"],
  ["interaction-ui", "acceptance-interaction-ui.cjs"],
  ["evidence-live", "acceptance-evidence-live.cjs"],
  ["evidence-ui", "acceptance-evidence-ui.cjs"],
  ["follow-ups", "acceptance-follow-ups.cjs"],
  ["follow-ups-ui", "acceptance-follow-ups-ui.cjs"],
  ["chat-live", "acceptance-chat-live.cjs"],
  ["chat-ui", "acceptance-chat-ui.cjs"],
  ["team", "acceptance-team.cjs"],
  ["stop", "acceptance-stop.cjs"],
  ["work-items-ui", "acceptance-work-items-ui.cjs"],
  ["live", "acceptance-live.cjs"],
]);
const scenario = process.argv[2];
const script = scenarios.get(scenario);
if (!script) {
  console.error(`Usage: node scripts/run-acceptance.cjs <scenario>
Scenarios: ${[...scenarios.keys()].join(", ")}`);
  process.exitCode = 1;
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [join(__dirname, script), ...process.argv.slice(3)],
    { env, stdio: "inherit", windowsHide: true },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
