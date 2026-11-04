const { spawn } = require("node:child_process");
const { join } = require("node:path");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [join(__dirname, "../tests/native-storage.cjs")],
  {
    stdio: "inherit",
    windowsHide: true,
    env,
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  process.exitCode = 1;
});
