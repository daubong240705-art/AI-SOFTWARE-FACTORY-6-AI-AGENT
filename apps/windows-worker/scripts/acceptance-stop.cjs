const { app, safeStorage } = require("electron");
const { resolve, join } = require("node:path");
const { writeFileSync } = require("node:fs");
const { execFile } = require("node:child_process");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
app.setName("ASF Windows Worker");
if (!app.requestSingleInstanceLock()) {
  console.error(
    "Đóng Windows Worker trước khi chạy acceptance để tránh hai controller dùng chung DB.",
  );
  app.exit(1);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
app.whenReady().then(async () => {
  let store, controller;
  let code = 0;
  try {
    store = new Store(app.getPath("userData"));
    controller = new RunController(store, app.getPath("userData"), () =>
      safeStorage.decryptString(store.encryptedKey()),
    );
    const project = store.addProject(resolve(__dirname, ".."));
    const run = controller.start(
      project.id,
      "Không sửa, tạo hoặc đọc file. Chỉ gọi bash với đúng lệnh Start-Sleep -Seconds 120 để kiểm tra nút Dừng. Không ghép thêm lệnh. Chờ kết quả công cụ.",
      "be",
    );
    let ready = false;
    const deadline = Date.now() + 90000;
    while (controller.view().activeId && Date.now() < deadline) {
      const detail = controller.detail(run.id);
      for (const permission of detail.run.permissions) {
        const allow =
          permission.permission === "bash" &&
          permission.patterns.every((p) => p === "Start-Sleep -Seconds 120");
        await controller.reply(run.id, permission.id, allow);
        if (allow) {
          ready = true;
          break;
        }
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready)
      throw new Error("Model did not request the exact sleep command.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pid = controller.active.runtime.child.pid;
    const listChildren = () =>
      new Promise((resolve, reject) =>
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `$all=Get-CimInstance Win32_Process; $ids=@(${pid}); for($i=0;$i -lt 4;$i++){ $ids+=@($all | Where-Object { $_.ParentProcessId -in $ids } | ForEach-Object { [int]$_.ProcessId }) }; @($ids | Select-Object -Unique) | ConvertTo-Json -Compress`,
          ],
          { windowsHide: true, timeout: 10000 },
          (error, stdout) =>
            error ? reject(error) : resolve(JSON.parse(stdout)),
        ),
      );
    const pids = await listChildren();
    const started = Date.now();
    await controller.stop(run.id);
    const result = controller.detail(run.id);
    const survivors = pids.filter(alive);
    const evidence = {
      runId: run.id,
      model: run.model,
      command: "Start-Sleep -Seconds 120",
      state: result.run.state,
      stopMilliseconds: Date.now() - started,
      ownedProcessCount: pids.length,
      survivorCount: survivors.length,
      activeId: controller.view().activeId,
      commands: result.run.commands.map(({ command, status, exitCode }) => ({
        command,
        status,
        exitCode,
      })),
    };
    writeFileSync(
      resolve(__dirname, "../../../docs/windows-worker/ww2-stop.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence, null, 2));
    if (
      result.run.state !== "cancelled" ||
      survivors.length ||
      controller.view().activeId
    )
      code = 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Stop acceptance failed",
    );
    code = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    app.exit(code);
  }
});
