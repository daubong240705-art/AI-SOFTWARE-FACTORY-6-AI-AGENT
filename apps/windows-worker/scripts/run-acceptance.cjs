const { spawn } = require("node:child_process");
const { join } = require("node:path");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [
    join(
      __dirname,
      process.argv[2] === "work-items-ui" || process.argv[2] === "board-ui"
        ? "acceptance-work-items-ui.cjs"
        : process.argv[2] === "overview-ui"
          ? "acceptance-overview-ui.cjs"
          : process.argv[2] === "ui-foundation"
            ? "acceptance-ui-foundation.cjs"
            : process.argv[2] === "office-selection-ui"
              ? "acceptance-office-selection-ui.cjs"
              : process.argv[2] === "office-state-ui"
                ? "acceptance-office-state-ui.cjs"
                : process.argv[2] === "office-ui"
                  ? "acceptance-office-ui.cjs"
                  : process.argv[2] === "inspector-ui"
                    ? "acceptance-inspector-ui.cjs"
                    : process.argv[2] === "parallel-ui"
                      ? "acceptance-parallel-ui.cjs"
                      : process.argv[2] === "parallel-live"
                        ? "acceptance-parallel-live.cjs"
                        : process.argv[2] === "workspaces-ui"
                          ? "acceptance-workspaces-ui.cjs"
                          : process.argv[2] === "lifecycle-live"
                            ? "acceptance-lifecycle-live.cjs"
                            : process.argv[2] === "lifecycle-ui"
                              ? "acceptance-lifecycle-ui.cjs"
                              : process.argv[2] === "interaction-ui"
                                ? "acceptance-interaction-ui.cjs"
                                : process.argv[2] === "evidence-live"
                                  ? "acceptance-evidence-live.cjs"
                                  : process.argv[2] === "evidence-ui"
                                    ? "acceptance-evidence-ui.cjs"
                                    : process.argv[2] === "follow-ups"
                                      ? "acceptance-follow-ups.cjs"
                                      : process.argv[2] === "follow-ups-ui"
                                        ? "acceptance-follow-ups-ui.cjs"
                                        : process.argv[2] === "chat-live"
                                          ? "acceptance-chat-live.cjs"
                                          : process.argv[2] === "chat-ui"
                                            ? "acceptance-chat-ui.cjs"
                                            : process.argv[2] === "team"
                                              ? "acceptance-team.cjs"
                                              : process.argv[2] === "stop"
                                                ? "acceptance-stop.cjs"
                                                : "acceptance-live.cjs",
    ),
    ...process.argv.slice(3),
  ],
  { env, stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
