const { spawn } = require("node:child_process");
const { join } = require("node:path");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [
    join(
      __dirname,
      process.argv[2] === "follow-ups"
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
  ],
  { env, stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
