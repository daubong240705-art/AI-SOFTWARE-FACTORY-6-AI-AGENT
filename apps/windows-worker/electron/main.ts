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
import { z } from "zod";
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

app.setName("ASF Windows Worker");
let store: Store;
let window: BrowserWindow | null = null;
let rendererUrl = "";
let fetchingModels = false;
let checkingTools = false;
let controller: RunController;
let quitting = false;

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
    return store.conversations.get(request.id, request.before);
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
  if (quitting || !controller?.view().activeId) return;
  event.preventDefault();
  void controller
    .shutdown()
    .then(() => {
      quitting = true;
      app.quit();
    })
    .catch(() => {
      if (!window) void createWindow();
      dialog.showErrorBox(
        "Chưa dừng được runtime",
        "Không thể xác nhận tiến trình đã dừng. Hãy bấm Dừng trong ứng dụng trước khi thoát.",
      );
    });
});
