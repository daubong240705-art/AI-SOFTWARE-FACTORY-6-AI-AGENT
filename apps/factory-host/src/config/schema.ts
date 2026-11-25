import { isAbsolute, posix } from "node:path";
import { isIP } from "node:net";
import { agentModelsSchema, reasoningEffortSchema } from "@factory/contracts";
import { isLoopbackHost, originsFor } from "../api/listen.js";

export type ConfigEnv = Readonly<Record<string, string | undefined>>;
export interface ConfigIssue { code: string; key: string; message: string; fix: string }

export const configKey = (key: string): boolean => /^(FACTORY_[A-Z0-9_]+|NINE_ROUTER_API_KEY|NODE_EXTRA_CA_CERTS)$/.test(key);
export const secretKey = (key: string): boolean => /(?:_API_KEY|_TOKEN|_PASSWORD|_SECRET|_WEBHOOK_URL)$/.test(key);
export const validLoginToken = (value: string | undefined): boolean => value !== undefined && value.length >= 24 && !/[\s\p{Cc}]/u.test(value);
export const onWindowsMount = (path: string): boolean => /^\/mnt(?:\/|$)/.test(posix.normalize(path.replaceAll("\\", "/")));
export const validModelName = (name: string): boolean => name.length > 0 && name.length <= 256 && !/[\s\p{Cc}]/u.test(name);

export function validModelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      && !url.username && !url.password && !url.search && !url.hash && !/[\s\p{Cc}]/u.test(value);
  } catch { return false; }
}

export function validateConfig(env: ConfigEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const invalid = (key: string, fix: string): void => { issues.push({ code: "C-VALUE", key, message: "Giá trị cấu hình không hợp lệ.", fix }); };
  for (const key of ["FACTORY_HOME", "FACTORY_STATE_DIR", "FACTORY_PROJECTS_ROOT", "FACTORY_WORKTREES_ROOT",
    "FACTORY_UI_DIR", "FACTORY_BACKUP_DIR", "FACTORY_MIGRATION_BACKUP_DIR", "FACTORY_EXTENSIONS_DIR"]) {
    const value = env[key];
    if (value !== undefined && (!isAbsolute(value) || /[\0\r\n]/.test(value) || (key === "FACTORY_STATE_DIR" && onWindowsMount(value))))
      invalid(key, key === "FACTORY_STATE_DIR" ? "Dùng đường dẫn tuyệt đối trên hệ thống tệp cục bộ, ngoài /mnt." : "Dùng đường dẫn tuyệt đối.");
  }
  if (env.FACTORY_EXTENSIONS?.trim() && extensionKeys(env).some((key) => !/^[a-z0-9-]{2,40}$/.test(key)))
    invalid("FACTORY_EXTENSIONS", "Dùng danh sách khóa tiện ích mở rộng, phân cách bằng dấu phẩy.");
  const integers = {
    FACTORY_PORT: [1, 65535], FACTORY_PROXY_PORT: [1, 65535], FACTORY_NODE_SLOTS: [1, 16],
    FACTORY_BACKUP_INTERVAL_MINUTES: [1, 1440], FACTORY_LEAD_MAX_OUTPUT_TOKENS: [256, 131072],
    FACTORY_LEAD_TIMEOUT_SECONDS: [10, 3600], FACTORY_BUDGET_TASK_TOKENS: [1, Number.MAX_SAFE_INTEGER],
    FACTORY_BUDGET_DAY_TOKENS: [1, Number.MAX_SAFE_INTEGER], FACTORY_DOC_MAX_BYTES: [1048576, 104857600],
    FACTORY_DOC_QUOTA_BYTES: [1, Number.MAX_SAFE_INTEGER],
  } as const;
  for (const [key, [min, max]] of Object.entries(integers)) {
    const value = env[key];
    if (value !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max))
      invalid(key, `Dùng số nguyên từ ${min} đến ${max}.`);
  }
  if (env.FACTORY_MODEL_PROVIDER !== undefined && !["openai-compatible", "none"].includes(env.FACTORY_MODEL_PROVIDER))
    invalid("FACTORY_MODEL_PROVIDER", "Dùng openai-compatible hoặc none.");
  if (env.FACTORY_MODEL_BASE_URL !== undefined && !validModelUrl(env.FACTORY_MODEL_BASE_URL))
    invalid("FACTORY_MODEL_BASE_URL", "Dùng URL HTTPS hoặc HTTP loopback, không kèm thông tin đăng nhập, truy vấn hay fragment.");
  if (env.FACTORY_MODEL_API_KEY && /[\s\p{Cc}]/u.test(env.FACTORY_MODEL_API_KEY))
    invalid("FACTORY_MODEL_API_KEY", "Dùng API key không chứa khoảng trắng hay ký tự điều khiển.");
  if (env.FACTORY_LEAD_MODEL !== undefined && !validModelName(env.FACTORY_LEAD_MODEL))
    invalid("FACTORY_LEAD_MODEL", "Chọn một mã model không chứa khoảng trắng.");
  if (env.FACTORY_AGENT_MODELS !== undefined && !agentModelsSchema.safeParse(env.FACTORY_AGENT_MODELS.split(",")).success)
    invalid("FACTORY_AGENT_MODELS", "Dùng từ 1 đến 8 mã model khác nhau, phân cách bằng dấu phẩy.");
  if (env.FACTORY_LEAD_EFFORT !== undefined && !reasoningEffortSchema.safeParse(env.FACTORY_LEAD_EFFORT).success)
    invalid("FACTORY_LEAD_EFFORT", "Dùng low, medium, high hoặc xhigh.");
  if (env.FACTORY_LEAD_CLI && env.FACTORY_LEAD_CLI !== "claude") invalid("FACTORY_LEAD_CLI", "Dùng claude hoặc bỏ khóa này.");
  if (env.FACTORY_DEFAULT_AGENT_CLI && !["codex", "claude"].includes(env.FACTORY_DEFAULT_AGENT_CLI))
    invalid("FACTORY_DEFAULT_AGENT_CLI", "Dùng codex, claude hoặc bỏ khóa này.");
  if (env.FACTORY_DEFAULT_AGENT_CLI && env.FACTORY_LOCAL_CLI !== "1") invalid("FACTORY_LOCAL_CLI", "Đặt FACTORY_LOCAL_CLI=1 để dùng CLI agent mặc định.");
  if (env.FACTORY_LOCAL_CLI !== undefined && env.FACTORY_LOCAL_CLI !== "0" && env.FACTORY_LOCAL_CLI !== "1")
    invalid("FACTORY_LOCAL_CLI", "Dùng 0 hoặc 1.");
  if (env.FACTORY_RUNTIME !== undefined && !["fake", "opencode"].includes(env.FACTORY_RUNTIME)) invalid("FACTORY_RUNTIME", "Dùng fake hoặc opencode.");
  const listen = env.FACTORY_LISTEN_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHost(listen) && (isIP(listen) !== 4 || listen === "0.0.0.0"))
    invalid("FACTORY_LISTEN_HOST", "Dùng 127.0.0.1, ::1 hoặc một địa chỉ IPv4 cụ thể của máy.");
  try { originsFor(0, allowedHosts(env)); } catch { invalid("FACTORY_ALLOWED_HOSTS", "Dùng danh sách tên máy hoặc địa chỉ IPv4 phân cách bằng dấu phẩy."); }
  if ((env.FACTORY_LOGIN_TOKEN || !isLoopbackHost(listen)) && !validLoginToken(env.FACTORY_LOGIN_TOKEN))
    invalid("FACTORY_LOGIN_TOKEN", "Đặt token ít nhất 24 ký tự không có khoảng trắng hoặc nghe trên loopback.");
  if (!isLoopbackHost(listen) && env.FACTORY_OPEN_LOGIN === "1")
    invalid("FACTORY_OPEN_LOGIN", "Tắt đăng nhập tự động khi nghe trên mạng LAN.");
  return issues;
}

export function extensionKeys(env: ConfigEnv): string[] {
  return env.FACTORY_EXTENSIONS?.trim() ? env.FACTORY_EXTENSIONS.split(",").map((key) => key.trim()) : [];
}

export const allowedHosts = (env: ConfigEnv): string[] => (env.FACTORY_ALLOWED_HOSTS ?? "").split(",").map((name) => name.trim()).filter(Boolean);

export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) { super("Cấu hình Factory không hợp lệ."); }
}

export function configError(key: string): ConfigError {
  return new ConfigError([{ code: "C-VALUE", key, message: "Cấu hình Host không hợp lệ.", fix: "Kiểm tra giá trị và các khóa liên quan trong factory.env.example." }]);
}

export function formatConfigError(error: ConfigError): string {
  return error.issues.map(({ code, key, message, fix }) => `${code} ${key}: ${message}\n  Cách sửa: ${fix}`).join("\n");
}
