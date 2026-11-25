import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { openStorage } from "../storage/database.js";
import { listBackups } from "../backup/service.js";
import { canonicalPath } from "../backup/verify.js";
import { isLoopbackHost } from "../api/listen.js";
import type { ConfigEnv } from "../config/schema.js";
import { onWindowsMount, validLoginToken } from "../config/schema.js";
import { directoryDefaults, extensionKeys } from "../config/index.js";
import { extensionPackDirs } from "../org/extensions.js";
import { loadPackRegistry } from "../org/registry.js";
import { ModelProbeError, probeCompletion, probeModels } from "./model-probe.js";

const checkSchema = z.object({ id: z.string(), level: z.enum(["required", "optional", "warning"]),
  status: z.enum(["pass", "fail", "skip"]), summary: z.string(), fix: z.string().optional(), detail: z.string().optional() });
const reportSchema = z.object({ ok: z.boolean(), checks: z.array(checkSchema) });
export const doctorResponseSchema = z.object({ ok: z.literal(true), apiVersion: z.number().int(), report: reportSchema });
export type DoctorResponse = z.infer<typeof doctorResponseSchema>;
export type DoctorCheck = z.infer<typeof checkSchema>;
export type DoctorReport = z.infer<typeof reportSchema>;
export interface ExecResult { code: number; stdout: string; stderr: string }
export type DoctorExec = (command: string, args?: readonly string[]) => Promise<ExecResult>;
export interface DoctorInput {
  config: ConfigEnv; stateDir: string; port: number; uiDir?: string; running?: boolean; checkModel?: boolean;
  fetch?: typeof fetch; exec?: DoctorExec;
}

const execFile = promisify(nodeExecFile);
export const execDoctorCommand: DoctorExec = async (command, args = []) => {
  try {
    const result = await execFile(command, [...args], { timeout: 10_000, windowsHide: true });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return { code: failure.code === "ENOENT" ? 127 : typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};

const pass = (id: string, level: DoctorCheck["level"], summary: string, detail?: string): DoctorCheck => ({ id, level, status: "pass", summary, ...(detail ? { detail } : {}) });
const fail = (id: string, level: DoctorCheck["level"], summary: string, fix: string, detail?: string): DoctorCheck => ({ id, level, status: "fail", summary, fix, ...(detail ? { detail } : {}) });
const skip = (id: string, level: DoctorCheck["level"], summary: string, detail?: string): DoctorCheck => ({ id, level, status: "skip", summary, ...(detail ? { detail } : {}) });

async function checkPort(port: number, host: string): Promise<string | undefined> {
  const server = createServer();
  try {
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(port, host, resolveListen); });
    return undefined;
  } catch (error) { return (error as NodeJS.ErrnoException).code ?? "UNKNOWN"; }
  finally { if (server.listening) await new Promise<void>((resolveClose) => server.close(() => resolveClose())); }
}

async function checkState(stateDir: string): Promise<DoctorCheck> {
  try {
    if (!isAbsolute(stateDir) || onWindowsMount(stateDir) || onWindowsMount(canonicalPath(stateDir)))
      return fail("D-STATE", "required", "Đường dẫn state không hợp lệ hoặc nằm trên /mnt.", "Đặt FACTORY_STATE_DIR tuyệt đối trên hệ thống tệp cục bộ, ngoài /mnt.");
    await mkdir(stateDir, { recursive: true });
    await access(stateDir, constants.R_OK | constants.W_OK | constants.X_OK);
    const temp = await mkdtemp(join(stateDir, ".doctor-"));
    const file = join(temp, "wal.db");
    try {
      const storage = openStorage(file);
      try { storage.raw.exec("CREATE TABLE probe (id INTEGER); INSERT INTO probe VALUES (1)"); } finally { storage.close(); }
    } finally { await rm(temp, { recursive: true, force: true }); }
    return pass("D-STATE", "required", "State ghi được và SQLite WAL hoạt động.");
  } catch { return fail("D-STATE", "required", "Không ghi được state hoặc SQLite WAL không hoạt động.", "Dùng hệ thống tệp cục bộ có hỗ trợ WAL và cấp quyền đọc/ghi cho tài khoản chạy Host."); }
}

async function checkModel(input: DoctorInput): Promise<DoctorCheck> {
  const base = input.config.FACTORY_MODEL_BASE_URL ?? input.config.FACTORY_GATEWAY_URL;
  const provider = input.config.FACTORY_MODEL_PROVIDER;
  const key = input.config.FACTORY_MODEL_API_KEY ?? input.config.NINE_ROUTER_API_KEY;
  if (provider === "none" || !base) return fail("D-MODEL", "optional", "Chưa cấu hình model provider (cần cho Lead chat và agent api-agent).", "Chạy: factory setup");
  try {
    const models = await probeModels(base, key, input.fetch);
    if (models.length === 0) return fail("D-MODEL", "required", "Model provider không có model nào.", "Kiểm tra quyền API và danh sách model.");
    const leadModel = input.config.FACTORY_LEAD_CLI === "claude" ? undefined : input.config.FACTORY_LEAD_MODEL;
    const requested = [leadModel, ...(input.config.FACTORY_AGENT_MODELS ?? "").split(",")].filter((value): value is string => Boolean(value));
    const missing = requested.filter((model) => !models.includes(model));
    // Some gateways serve models they do not list (e.g. a newer model behind an alias list), so an unlisted model is
    // only a warning; the real call (checkModel) decides.
    if (missing.length && !input.checkModel)
      return fail("D-MODEL", "warning", `Model ${missing.join(", ")} không có trong danh sách GET /models của model provider.`,
        "Bấm \"Kiểm tra cả model\" (hoặc factory doctor --model) để gọi thử thật; nếu lỗi thì chọn model có trong danh sách.");
    if (input.checkModel) {
      for (const model of requested.length ? requested : [models[0]!]) await probeCompletion(base, key, model, input.fetch);
      return pass("D-MODEL", "required", missing.length
        ? `Chat completion hoạt động với ${requested.join(", ")} (có model không được liệt kê nhưng vẫn dùng được).`
        : "GET /models và chat completion hoạt động.");
    }
    return pass("D-MODEL", "required", input.checkModel ? "GET /models và chat completion hoạt động." : "GET /models hoạt động và model đã chọn có sẵn.");
  } catch (error) { return modelProbeFailure(error); }
}

/** Turns a provider probe error into a specific, actionable Vietnamese fix (no secrets, no raw stack). */
function modelProbeFailure(error: unknown): DoctorCheck {
  const status = error instanceof ModelProbeError ? error.status : undefined;
  const chain: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const item = current as { code?: unknown; message?: unknown; cause?: unknown };
    chain.push(`${typeof item.code === "string" ? item.code : ""} ${typeof item.message === "string" ? item.message : ""}`);
    current = item.cause;
  }
  const text = chain.join(" ");
  const summary = "Kiểm tra model provider thất bại.";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|unable to get local issuer/i.test(text))
    return fail("D-MODEL", "required", `${summary} Chứng chỉ TLS của máy chủ không được tin cậy.`,
      "Đặt NODE_EXTRA_CA_CERTS tới file CA gốc của máy chủ model (ví dụ CA nội bộ của reverse proxy) trong file cấu hình hoặc dịch vụ, rồi khởi động lại.", "tls");
  if (/ENOTFOUND|EAI_AGAIN/i.test(text))
    return fail("D-MODEL", "required", `${summary} Không phân giải được tên máy chủ.`, "Kiểm tra FACTORY_MODEL_BASE_URL và DNS của máy này.", "dns");
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout|aborted/i.test(text))
    return fail("D-MODEL", "required", `${summary} Không kết nối được tới máy chủ.`, "Kiểm tra máy chủ model đang chạy, cổng, tường lửa và proxy.", "network");
  if (status === 401 || status === 403)
    return fail("D-MODEL", "required", `${summary} API key bị từ chối (HTTP ${status}).`, "Chạy factory setup để nhập lại API key.", `HTTP ${status}`);
  if (status === 429)
    return fail("D-MODEL", "required", `${summary} Đã chạm hạn mức (HTTP 429).`, "Chờ hạn mức hồi lại hoặc tăng hạn mức ở model provider.", "HTTP 429");
  return fail("D-MODEL", "required", summary, "Kiểm tra URL, CA, mạng, API key và hạn mức.", status === undefined ? undefined : `HTTP ${status}`);
}

async function checkCli(id: "D-CODEX" | "D-CLAUDE", command: string, statusArgs: string[], exec: DoctorExec): Promise<DoctorCheck> {
  const version = await exec(command, ["--version"]);
  if (version.code !== 0) return fail(id, "optional", `${command} không có trong PATH.`, `Cài ${command} và chạy lệnh đăng nhập của ${command}.`);
  const status = await exec(command, statusArgs);
  const output = `${status.stdout}\n${status.stderr}`;
  if (status.code === 127 || /(?:unknown|unrecognized|unsupported|invalid) (?:sub)?command|unexpected argument|no such command/i.test(output))
    return { ...skip(id, "optional", `${command} có trong PATH; trạng thái đăng nhập chưa rõ.`), fix: "Kiểm tra đăng nhập thủ công hoặc cập nhật CLI." };
  if (status.code === 0 && !/"loggedIn"\s*:\s*false|\bnot logged in\b/i.test(output))
    return pass(id, "optional", `${command} có trong PATH và đã đăng nhập.`);
  return fail(id, "optional", `${command} có trong PATH nhưng chưa xác nhận đăng nhập.`, `Chạy ${command} ${statusArgs.join(" ")} và đăng nhập nếu cần.`);
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const exec = input.exec ?? execDoctorCommand;
  const checks: DoctorCheck[] = [];
  const enabled = extensionKeys(input.config);
  if (!enabled.length) checks.push(skip("D-EXT", "optional", "Chưa bật tiện ích mở rộng nào."));
  else {
    const issues: string[] = [];
    const report = (message: string) => { issues.push(message); };
    const dir = input.config.FACTORY_EXTENSIONS_DIR ?? directoryDefaults(input.config).FACTORY_EXTENSIONS_DIR!;
    const extraDirs = extensionPackDirs(dir, enabled, report);
    loadPackRegistry("", { coreEntries: [], extraDirs, onExtensionPackError: report });
    checks.push(issues.length ? fail("D-EXT", "required", "Không tải được một số tiện ích mở rộng hoặc pack.",
      "Kiểm tra FACTORY_EXTENSIONS, FACTORY_EXTENSIONS_DIR và các tệp extension.json, pack.json.")
      : pass("D-EXT", "required", "Đã tải các tiện ích mở rộng và pack hợp lệ."));
  }
  const [node, state, git, name, email, model, codex, claude, bwrap] = await Promise.all([
    exec(process.execPath, ["--version"]), checkState(input.stateDir), exec("git", ["--version"]),
    exec("git", ["config", "--global", "user.name"]), exec("git", ["config", "--global", "user.email"]), checkModel(input),
    checkCli("D-CODEX", "codex", ["login", "status"], exec), checkCli("D-CLAUDE", "claude", ["auth", "status"], exec),
    exec("bwrap", ["--ro-bind", "/", "/", "true"]),
  ]);
  const version = /^v(\d+)\.(\d+)\.(\d+)/.exec(node.stdout.trim());
  const nodeOk = node.code === 0 && version !== null && (Number(version[1]) > 22 || (Number(version[1]) === 22 && Number(version[2]) >= 20));
  checks.push(nodeOk ? pass("D-NODE", "required", `Node.js ${version![0]}.`) : fail("D-NODE", "required", "Node.js phải từ 22.20 trở lên.", "Cài Node.js 22.20 hoặc mới hơn."));
  checks.push(state);
  // The Host commits agent work with its own identity ("Factory"), so only the git binary is required.
  const identity = name.code === 0 && Boolean(name.stdout.trim()) && email.code === 0 && Boolean(email.stdout.trim());
  checks.push(git.code !== 0
    ? fail("D-GIT", "required", "Chưa cài Git.", "Cài Git bằng trình quản lý gói của hệ điều hành.")
    : pass("D-GIT", "required", identity ? "Git sẵn sàng." : "Git sẵn sàng; Host tự dùng danh tính commit \"Factory\".",
      identity ? undefined : "Chưa đặt git config --global user.name/user.email; chỉ cần khi bạn tự commit."));
  const listenHost = input.config.FACTORY_LISTEN_HOST?.trim() || "127.0.0.1";
  const portError = input.running ? undefined : await checkPort(input.port, listenHost);
  checks.push(portError === undefined ? pass("D-PORT", "required", input.running ? "Host đang chạy trên cổng cấu hình." : "Cổng Host còn trống.")
    : portError === "EADDRINUSE" ? fail("D-PORT", "required", "Cổng Host đang được sử dụng.", "Dừng tiến trình đang dùng cổng hoặc đổi FACTORY_PORT.")
    : fail("D-PORT", "required", "Không mở được địa chỉ và cổng của Host.", "Kiểm tra FACTORY_LISTEN_HOST, FACTORY_PORT và quyền mở cổng."));
  if (!input.uiDir) checks.push(fail("D-UI", "required", "Chưa cấu hình thư mục UI.", "Build UI hoặc đặt FACTORY_UI_DIR tới thư mục có index.html."));
  else try {
    const index = join(input.uiDir, "index.html");
    if (!(await stat(index)).isFile()) throw new Error();
    await access(index, constants.R_OK);
    checks.push(pass("D-UI", "required", "Bản build UI có index.html."));
  }
    catch { checks.push(fail("D-UI", "required", "Không tìm thấy index.html của UI.", "Build UI và đặt FACTORY_UI_DIR tới thư mục dist.")); }
  checks.push(model, codex, claude);
  checks.push(bwrap.code === 0 ? pass("D-BWRAP", input.config.FACTORY_RUNTIME === "opencode" ? "required" : "optional", "Bubblewrap chạy được sandbox probe.")
    : input.config.FACTORY_RUNTIME === "opencode" ? fail("D-BWRAP", "required", "Bubblewrap không chạy được.", "Cài bubblewrap và kiểm tra quyền user namespace.") : fail("D-BWRAP", "optional", "Bubblewrap chưa sẵn sàng.", "Cài bubblewrap nếu dùng OpenCode."));
  checks.push(!isLoopbackHost(listenHost) ? (validLoginToken(input.config.FACTORY_LOGIN_TOKEN) && input.config.FACTORY_OPEN_LOGIN !== "1"
    ? pass("D-LAN", "required", "Nghe trên LAN có login token an toàn.")
    : fail("D-LAN", "required", "Cấu hình đăng nhập LAN không an toàn.", "Đặt FACTORY_LOGIN_TOKEN ít nhất 24 ký tự và tắt FACTORY_OPEN_LOGIN."))
    : input.config.FACTORY_LOGIN_TOKEN && !validLoginToken(input.config.FACTORY_LOGIN_TOKEN)
      ? fail("D-LAN", "required", "Login token không hợp lệ.", "Đặt token ít nhất 24 ký tự không có khoảng trắng hoặc bỏ token khi nghe trên loopback.")
      : pass("D-LAN", "required", "Host chỉ nghe trên loopback."));
  const backupDir = input.config.FACTORY_BACKUP_DIR ?? join(input.stateDir, "backups", "periodic");
  try {
    if (state.status !== "pass" && !input.config.FACTORY_BACKUP_DIR) throw new Error();
    await mkdir(backupDir, { recursive: true }); await access(backupDir, constants.R_OK | constants.W_OK | constants.X_OK);
    const temp = await mkdtemp(join(backupDir, ".doctor-"));
    try { await writeFile(join(temp, "probe"), "", { flag: "wx" }); } finally { await rm(temp, { recursive: true, force: true }); }
    const newest = listBackups(backupDir)[0];
    checks.push(!newest ? fail("D-BACKUP", "warning", "Thư mục backup ghi được nhưng chưa có backup nào.", "Chạy backup đầu tiên sau khi cấu hình Host.")
      : Date.now() - newest.at.getTime() > 86_400_000 ? fail("D-BACKUP", "warning", "Backup mới nhất đã quá 24 giờ.", "Chạy backup và kiểm tra scheduler.") : pass("D-BACKUP", "warning", "Thư mục backup ghi được và có backup mới."));
  } catch { checks.push(fail("D-BACKUP", "warning", "Thư mục backup không ghi được.", "Tạo thư mục backup và cấp quyền cho tài khoản chạy Host.")); }
  const ca = input.config.NODE_EXTRA_CA_CERTS;
  if (ca) try {
    if (!(await stat(ca)).isFile()) throw new Error();
    await access(ca, constants.R_OK);
    checks.push(pass("D-CA", "optional", "NODE_EXTRA_CA_CERTS trỏ tới file đọc được.",
      process.env.NODE_EXTRA_CA_CERTS === ca ? undefined : "Đặt biến này trong launcher/dịch vụ trước khi chạy Node.js."));
  }
    catch { checks.push(fail("D-CA", "optional", "Không đọc được file NODE_EXTRA_CA_CERTS.", "Đặt NODE_EXTRA_CA_CERTS tới file CA có quyền đọc.")); }
  else checks.push(skip("D-CA", "optional", "Không cấu hình CA bổ sung."));
  return { ok: checks.filter((check) => check.level === "required").every((check) => check.status === "pass"), checks };
}
