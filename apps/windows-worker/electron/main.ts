import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { chatSendSchema } from "../shared/chat";
import { answerQuestionsSchema, questionRefSchema } from "../shared/questions";
import { redact } from "./runtime/security";
import { monitorRequestSchema } from "../shared/monitor";
import {
  createBoardItemSchema,
  updateBoardItemSchema,
  moveBoardItemSchema,
  boardVersionSchema,
  submitBoardItemSchema,
  workItemPageSchema,
  workCommentSchema,
  workItemRefSchema,
  materializeWorkItemSchema,
} from "../shared/board";
import { evidenceRefSchema } from "../shared/evidence";
import { readEvidence } from "./team/evidence";
import {
  channels,
  idSchema,
  saveSettingsSchema,
  type Bootstrap,
  type Reply,
  roles,
} from "../shared/contracts";
import { RunController } from "./controller/runs";
import { Store } from "./storage/database";
import {
  canonicalDirectory,
  checkTools,
  projectStatus,
} from "./workspace/projects";
import { fetchModels } from "./gateway/client";
import { WorkspaceFiles } from "./workspace/files";
import { LocalCommands, commandCatalog } from "./workspace/commands";
import { recoverOwnedJobs } from "./runtime/owned-process";
import { Worktrees } from "./workspace/worktrees";

app.setName("ASF Windows Worker");
let store: Store;
let window: BrowserWindow | null = null;
let rendererUrl = "";
let fetchingModels = false;
let checkingTools = false;
let controller: RunController;
let quitting = false;
let local: LocalCommands;
let closePending = false;

function bootstrap(): Bootstrap {
  return {
    settings: store.settings(),
    projects: store.projects(),
    models: store.models(),
    hasKey: !!store.encryptedKey(),
    secureStorage: safeStorage.isEncryptionAvailable(),
  };
}
function key(): string | undefined {
  const encrypted = store.encryptedKey();
  if (!encrypted) return undefined;
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Windows secure storage không khả dụng.");
  try {
    return safeStorage.decryptString(encrypted);
  } catch {
    throw new Error("Không giải mã được API key. Hãy nhập và lưu lại key.");
  }
}
function registerIPC(): void {
  handle(channels.questionSet, (input) =>
    store.questions.get(questionRefSchema.parse(input)),
  );
  handle(channels.saveQuestionDraft, (input) =>
    store.questions.draft(answerQuestionsSchema.parse(input)),
  );
  handle(channels.answerQuestions, (input) =>
    controller.answerQuestions(answerQuestionsSchema.parse(input)),
  );
  handle(channels.taskFileDiff, (input) => {
    const ref = evidenceRefSchema.parse(input);
    return store.evidence.taskDiff(controller.detail(ref.runId).run, ref);
  });
  const worktrees = new Worktrees(app.getPath("userData"), (path) =>
    store.workspaceReferenced(path),
  );
  const files = new WorkspaceFiles(
    store,
    () => {
      controller.assertWorkspaceIdle();
      if (local.busy())
        throw new Error("Dừng lệnh local trước khi khôi phục file.");
    },
    (fn) => {
      if (local.busy())
        throw new Error("Dừng lệnh local trước khi khôi phục file.");
      return controller.workspaceAction(fn);
    },
  );
  function handle<T>(
    channel: string,
    action: (input: unknown) => Promise<T> | T,
  ): void {
    ipcMain.handle(channel, async (event, input): Promise<Reply<T>> => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== rendererUrl
      ) {
        return { ok: false, error: "Nguồn yêu cầu không được phép." };
      }
      try {
        return { ok: true, value: await action(input) };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof z.ZodError
              ? (error.issues[0]?.message ?? "Dữ liệu không hợp lệ.")
              : error instanceof Error && !("code" in error)
                ? error.message
                : "Không thực hiện được thao tác. Kiểm tra đường dẫn và quyền truy cập.",
        };
      }
    });
  }
  const empty = (input: unknown): void => {
    z.undefined().parse(input);
  };
  handle(channels.sendChat, (input) =>
    controller.sendChat(chatSendSchema.parse(input)),
  );
  handle(channels.workChatForRun, (input) => {
    const ref = z
      .object({ projectId: idSchema, runId: idSchema })
      .strict()
      .parse(input);
    return store.board.contextForRun(ref.projectId, ref.runId);
  });
  handle(channels.workChat, (input) =>
    store.board.workChat(workItemRefSchema.parse(input)),
  );
  function workspaceOperation<T>(fn: () => Promise<T>): Promise<T> {
    if (closePending || quitting || local.busy())
      throw new Error("Dừng công việc/lệnh local trước khi quản lý workspace.");
    return controller.workspaceAction(async () => {
      await recoverOwnedJobs(app.getPath("userData"));
      return fn();
    });
  }
  handle(channels.workspaces, (input) => {
    const id = idSchema.parse(input);
    store.project(id);
    return worktrees.list(id);
  });
  handle(channels.createWorkspace, (input) => {
    const id = idSchema.parse(input);
    return workspaceOperation(() =>
      worktrees.create(id, store.project(id).path),
    );
  });
  handle(channels.openWorkspace, (input) => {
    const id = idSchema.parse(input);
    return workspaceOperation(async () => {
      const workspace = await worktrees.open(id);
      return store.addProject(workspace.path);
    });
  });
  handle(channels.recoverWorkspace, (input) => {
    const id = idSchema.parse(input);
    return workspaceOperation(() => worktrees.recover(id));
  });
  handle(channels.previewWorkspaceRemoval, (input) => {
    const id = idSchema.parse(input);
    return workspaceOperation(() => worktrees.previewRemoval(id));
  });
  handle(channels.removeWorkspace, (input) => {
    const token = idSchema.parse(input);
    return workspaceOperation(() => worktrees.remove(token));
  });
  handle(channels.commandCatalog, (input) =>
    commandCatalog(store.project(idSchema.parse(input)).path),
  );
  handle(channels.localCommand, (input) => {
    empty(input);
    return local.view();
  });
  handle(channels.startCommand, (input) => {
    if (closePending || quitting)
      throw new Error("Ứng dụng đang xử lý đóng cửa sổ.");
    const q = z
      .object({
        projectId: idSchema,
        script: z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/),
      })
      .strict()
      .parse(input);
    return controller.workspaceAction(async () => {
      await recoverOwnedJobs(app.getPath("userData"));
      return local.start(
        q.projectId,
        store.project(q.projectId).path,
        q.script,
      );
    });
  });
  handle(channels.stopCommand, (input) => {
    empty(input);
    return local.stop();
  });
  handle(channels.recovery, (input) => {
    if (local.busy())
      throw new Error("Dừng lệnh local trước khi kiểm tra khôi phục.");
    return controller.recovery(idSchema.parse(input));
  });
  handle(channels.continueRecovery, (input) => {
    if (local.busy()) throw new Error("Dừng lệnh local trước khi tiếp tục.");
    return controller.continueRecovery(idSchema.parse(input));
  });
  handle(channels.exportRun, async (input) => {
    const id = idSchema.parse(input);
    const secret = key();
    const report = store.report(id, secret ? [secret] : []);
    const target = await dialog.showSaveDialog(window!, {
      title: "Xuất báo cáo",
      defaultPath: `run-${id}.json`,
      filters: [{ name: "JSON report", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) return false;
    await writeFile(target.filePath, report, { encoding: "utf8" });
    return true;
  });
  handle(channels.retention, (input) => {
    const q = z
      .object({
        days: z.number().int().min(1).max(3650),
        keep: z.number().int().min(1).max(1000),
      })
      .strict()
      .parse(input);
    return store.retention(q.days, q.keep);
  });
  handle(channels.prune, (input) => {
    controller.assertWorkspaceIdle();
    return store.prune(idSchema.parse(input));
  });
  const fileInput = z
    .object({ runId: idSchema, path: z.string().min(1).max(4096) })
    .strict();
  handle(channels.evidence, (input) =>
    store.evidence.view(idSchema.parse(input)),
  );
  handle(channels.acceptanceEvidence, (input) => {
    const ref = evidenceRefSchema.parse(input);
    return readEvidence(store.run(ref.runId), ref, store.evidence);
  });
  handle(channels.commandOutput, (input) => {
    const q = z
      .object({
        runId: idSchema,
        callId: z.string().min(1).max(200),
        artifactId: z
          .string()
          .regex(/^cmd-v1-[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    const command = store
      .run(q.runId)
      .commands.find(
        (c) => c.callId === q.callId && c.artifactId === q.artifactId,
      );
    if (!command) throw new Error("Không có command tương ứng.");
    return store.evidence.command(q.runId, q.artifactId ?? q.callId);
  });
  handle(channels.fileDiff, (input) => {
    const q = fileInput
      .extend({
        comparison: z.enum(["run", "staged", "unstaged"]),
        source: z.enum(["before", "after"]),
      })
      .strict()
      .parse(input);
    return store.evidence.diff(q.runId, q.path, q.comparison, q.source);
  });
  handle(channels.previewRestore, (input) => {
    const q = fileInput.parse(input);
    return files.preview(q.runId, q.path);
  });
  handle(channels.restoreFile, (input) => files.restore(idSchema.parse(input)));
  handle(channels.revealFile, async (input) => {
    const q = fileInput.parse(input);
    const path = await files.resolve(q.runId, q.path);
    shell.showItemInFolder(path);
  });
  handle(channels.startRun, (input) => {
    const request = z
      .object({
        projectId: idSchema,
        conversationId: idSchema.optional(),
        prompt: z.string().trim().min(1).max(32000),
        role: z.enum(roles),
        mode: z.enum(["direct", "team"]).optional(),
      })
      .strict()
      .parse(input);
    return controller.start(
      request.projectId,
      request.prompt,
      request.role,
      request.mode,
      request.conversationId,
    );
  });
  handle(channels.enqueue, (input) => {
    const q = z
      .object({
        projectId: idSchema,
        conversationId: idSchema,
        prompt: z.string().trim().min(1).max(32000),
        role: z.enum(roles),
        mode: z.enum(["direct", "team"]),
      })
      .strict()
      .parse(input);
    return controller.enqueue(
      q.projectId,
      q.conversationId,
      q.prompt,
      q.role,
      q.mode,
    );
  });
  handle(channels.editFollowUp, (input) => {
    const q = z
      .object({ id: idSchema, prompt: z.string().trim().min(1).max(32000) })
      .strict()
      .parse(input);
    store.queue.edit(q.id, q.prompt);
  });
  handle(channels.removeFollowUp, (input) =>
    store.queue.remove(idSchema.parse(input)),
  );
  handle(channels.resumeFollowUp, (input) =>
    controller.resume(idSchema.parse(input)),
  );
  handle(channels.retryRun, (input) => controller.retry(idSchema.parse(input)));
  handle(channels.conversations, (input) =>
    store.conversations.list(
      z
        .object({
          projectId: idSchema.optional(),
          search: z.string().max(200).optional(),
        })
        .strict()
        .parse(input),
    ),
  );
  handle(channels.conversation, (input) => {
    const request = z
      .object({ id: idSchema, before: z.number().int().positive().optional() })
      .strict()
      .parse(input);
    return {
      ...store.conversations.get(request.id, request.before),
      questionSets: store.questions.list(request.id),
      queue: store.queue.list(request.id),
    };
  });
  handle(channels.createConversation, (input) =>
    store.conversations.create(idSchema.parse(input)),
  );
  handle(channels.renameConversation, (input) => {
    const request = z
      .object({ id: idSchema, title: z.string().trim().min(1).max(100) })
      .strict()
      .parse(input);
    return store.conversations.rename(request.id, request.title);
  });
  handle(channels.saveConversationDraft, (input) => {
    const request = z
      .object({ id: idSchema, draft: z.string().max(32000) })
      .strict()
      .parse(input);
    return store.conversations.draft(request.id, request.draft);
  });
  handle(channels.openExternal, async (input) => {
    const url = z.string().url().max(2048).parse(input);
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Chỉ mở liên kết HTTP/HTTPS.");
    await shell.openExternal(parsed.href);
  });
  handle(channels.stopRun, (input) => controller.stop(idSchema.parse(input)));
  handle(channels.runtimeView, (input) => {
    empty(input);
    return controller.view();
  });
  handle(channels.monitorSnapshot, (input) =>
    controller.monitor(monitorRequestSchema.parse(input)),
  );
  handle(channels.createBoardItem, (input) =>
    store.board.create(createBoardItemSchema.parse(input)),
  );
  handle(channels.workItemDetail, (input) =>
    store.board.detail(workItemPageSchema.parse(input)),
  );
  handle(channels.workItemComments, (input) =>
    store.board.commentPage(workItemPageSchema.parse(input)),
  );
  handle(channels.addWorkComment, (input) =>
    store.board.addComment(workCommentSchema.parse(input)),
  );
  handle(channels.materializeWorkItem, (input) =>
    store.board.materialize(materializeWorkItemSchema.parse(input)),
  );
  handle(channels.exportWorkItem, async (input) => {
    const ref = workItemRefSchema.parse(input);
    const report = store.board.exportItem(ref);
    const target = await dialog.showSaveDialog(window!, {
      title: "Xuất hồ sơ công việc",
      defaultPath: `${report.item.code}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) return false;
    const secret = key();
    await writeFile(
      target.filePath,
      JSON.stringify(
        report,
        (_field, value) =>
          typeof value === "string"
            ? redact(value, secret ? [secret] : [], Infinity)
            : value,
        2,
      ),
      "utf8",
    );
    return true;
  });
  handle(channels.boardItem, (input) =>
    store.board.item(idSchema.parse(input)),
  );
  handle(channels.updateBoardItem, (input) =>
    store.board.update(updateBoardItemSchema.parse(input)),
  );
  handle(channels.moveBoardItem, (input) =>
    store.board.move(moveBoardItemSchema.parse(input)),
  );
  handle(channels.archiveBoardItem, (input) =>
    store.board.archive(
      boardVersionSchema
        .extend({ archived: z.boolean() })
        .strict()
        .parse(input),
    ),
  );
  handle(channels.submitBoardItem, (input) =>
    controller.submitBoard(submitBoardItemSchema.parse(input)),
  );
  handle(channels.runDetail, (input) =>
    controller.detail(idSchema.parse(input)),
  );
  handle(channels.replyPermission, (input) => {
    const request = z
      .object({
        runId: idSchema,
        requestId: z.string().min(1).max(200),
        allow: z.boolean(),
      })
      .strict()
      .parse(input);
    return controller.reply(request.runId, request.requestId, request.allow);
  });
  handle(channels.bootstrap, (input) => {
    empty(input);
    return bootstrap();
  });
  handle(channels.chooseProject, async (input) => {
    empty(input);
    const result = await dialog.showOpenDialog(window!, {
      title: "Chọn thư mục dự án",
      properties: ["openDirectory"],
    });
    return result.canceled
      ? null
      : store.addProject(await canonicalDirectory(result.filePaths[0]));
  });
  handle(channels.openProject, async (input) => {
    const project = store.project(idSchema.parse(input));
    await canonicalDirectory(project.path);
    return store.touch(project.id);
  });
  handle(channels.removeProject, (input) =>
    store.removeProject(idSchema.parse(input)),
  );
  handle(channels.projectStatus, (input) =>
    projectStatus(store.project(idSchema.parse(input)).path),
  );
  handle(channels.revealProject, async (input) => {
    const path = await canonicalDirectory(
      store.project(idSchema.parse(input)).path,
    );
    if (await shell.openPath(path))
      throw new Error("Không mở được thư mục trong Explorer.");
  });
  handle(channels.saveDraft, (input) => {
    const value = z
      .object({ id: idSchema, draft: z.string().max(32000) })
      .strict()
      .parse(input);
    store.saveDraft(value.id, value.draft);
  });
  handle(channels.saveSettings, (input) => {
    const value = saveSettingsSchema.parse(input);
    const previous = store.settings().gatewayUrl;
    if (
      value.keyAction === "keep" &&
      store.encryptedKey() &&
      (previous ? new URL(previous).origin : "") !==
        (value.settings.gatewayUrl
          ? new URL(value.settings.gatewayUrl).origin
          : "")
    ) {
      throw new Error(
        "Đổi máy chủ gateway cần nhập key mới hoặc chọn xóa key đã lưu.",
      );
    }
    let encrypted: Buffer | null | undefined;
    if (value.keyAction === "replace") {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "Windows secure storage không khả dụng. API key chưa được lưu.",
        );
      encrypted = safeStorage.encryptString(value.apiKey!.trim());
    } else if (value.keyAction === "remove") encrypted = null;
    store.save(value.settings, encrypted);
    return bootstrap();
  });
  handle(channels.chooseFile, async (input) => {
    const kind = z.enum(["ca", "runtime"]).parse(input);
    const result = await dialog.showOpenDialog(window!, {
      title: kind === "ca" ? "Chọn chứng chỉ CA" : "Chọn OpenCode executable",
      properties: ["openFile"],
      filters:
        kind === "ca"
          ? [{ name: "CA certificate", extensions: ["crt", "pem", "cer"] }]
          : [{ name: "Executable", extensions: ["exe"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle(channels.fetchModels, async (input) => {
    empty(input);
    if (fetchingModels) throw new Error("Đang tải model. Vui lòng chờ.");
    fetchingModels = true;
    try {
      const models = await fetchModels(store.settings(), key());
      store.setModels(models);
      return models;
    } finally {
      fetchingModels = false;
    }
  });
  handle(channels.checkTools, async (input) => {
    empty(input);
    if (checkingTools) throw new Error("Đang đọc phiên bản công cụ.");
    checkingTools = true;
    try {
      return await checkTools(store.settings().runtimePath);
    } finally {
      checkingTools = false;
    }
  });
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1260,
    height: 850,
    minWidth: 820,
    minHeight: 640,
    show: false,
    title: "ASF Windows Worker",
    backgroundColor: "#18181a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once("ready-to-show", () => window?.show());
  window.on("close", (event) => {
    if (!quitting && (controller.isBusy() || local.busy())) {
      event.preventDefault();
      void requestClose();
    }
  });
  window.on("closed", () => {
    window = null;
  });
  const dev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
  if (dev) {
    rendererUrl = new URL(dev).href;
    await window.loadURL(dev);
  } else {
    const file = join(__dirname, "../renderer/index.html");
    rendererUrl = pathToFileURL(file).href;
    await window.loadFile(file);
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    try {
      store = new Store(app.getPath("userData"));
      controller = new RunController(store, app.getPath("userData"), key);
      local = new LocalCommands(app.getPath("userData"), () => {
        const value = key();
        return value ? [value] : [];
      });
      await local.restore();
      registerIPC();
      await createWindow();
      app.on("activate", () => {
        if (!window) void createWindow();
      });
    } catch {
      dialog.showErrorBox(
        "Không mở được Windows Worker",
        "Không khởi tạo được ứng dụng hoặc dữ liệu local. Kiểm tra quyền thư mục dữ liệu và native SQLite module.",
      );
      app.quit();
    }
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => store?.close());
app.on("before-quit", (event) => {
  if (quitting || (!controller?.isBusy() && !local?.busy())) return;
  event.preventDefault();
  void requestClose();
});
async function requestClose(): Promise<void> {
  if (closePending) return;
  closePending = true;
  try {
    const choice = await dialog.showMessageBox(window!, {
      type: "question",
      message: "Công việc hoặc lệnh local còn chạy",
      buttons: ["Tiếp tục làm việc", "Dừng và đóng"],
      cancelId: 0,
      defaultId: 0,
    });
    if (choice.response !== 1) return;
    await controller.shutdown();
    await local.stop();
    quitting = true;
    app.quit();
  } catch {
    dialog.showErrorBox(
      "Chưa dừng được tiến trình",
      "Ứng dụng giữ nguyên cửa sổ. Bấm Dừng để thử lại trước khi thoát.",
    );
  } finally {
    closePending = false;
  }
}
