const { spawn } = require("node:child_process");
const { join } = require("node:path");
// Some editor/agent environments export this for their own Node helpers.
// It must not turn our Electron application into a Node-only process.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.execPath,
  [
    join(__dirname, "../node_modules/electron-vite/bin/electron-vite.js"),
    process.argv[2],
  ],
  { stdio: "inherit", env, windowsHide: true },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Không khởi chạy được Electron. Chạy npm ci rồi thử lại.");
  process.exitCode = 1;
});
