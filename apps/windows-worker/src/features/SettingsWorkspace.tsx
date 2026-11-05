import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { Save, LoaderCircle, FolderOpen } from "lucide-react";
import type { Bootstrap, Settings, ToolStatus } from "../../shared/contracts";
import {
  applySharedModel,
  applyModelPreset,
  type ModelPreset,
  type SetupSection,
} from "../../shared/setup";
import { Select } from "../ui/Select";
import { ModelField } from "./ModelField";
import { HistoryTools } from "./HistoryTools";

const names = {
  lead: "Lead",
  pm: "PM",
  ba: "BA",
  be: "BE",
  fe: "FE",
  test: "TEST",
  devops: "DEVOPS",
};
const sections: Record<SetupSection, string> = {
  models: "Model & quyền",
  runtime: "Runtime & công cụ",
  data: "Dữ liệu",
};
export function SettingsWorkspace({
  boot,
  settings,
  setSettings,
  busy,
  dirty,
  keyAction,
  setKeyAction,
  keyInput,
  onSave,
  onCatalog,
  onChooseFile,
  onAction,
  active,
  onChanged,
  initialSection,
}: {
  boot: Bootstrap;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  busy: string | null;
  dirty: boolean;
  keyAction: "keep" | "replace" | "remove";
  setKeyAction: (action: "keep" | "replace" | "remove") => void;
  keyInput: RefObject<HTMLInputElement | null>;
  onSave: () => void;
  onCatalog: () => Promise<string[]>;
  onChooseFile: (kind: "ca" | "runtime") => void;
  onAction: (name: string, action: () => Promise<void>) => Promise<void>;
  active: boolean;
  onChanged: () => void;
  initialSection: SetupSection;
}) {
  const [section, setSection] = useState(initialSection);
  const [common, setCommon] = useState("");
  const [preset, setPreset] = useState<ModelPreset>("balanced");
  const [presetModels, setPresetModels] = useState({
    fast: "",
    planning: "",
    coding: "",
  });
  const [connection, setConnection] = useState<{
    ok: boolean;
    message: string;
    at: string;
  } | null>(null);
  const [tools, setTools] = useState<{
    path: string;
    values: ToolStatus[];
    at: string;
  } | null>(null);
  const [toolError, setToolError] = useState("");
  // Keep the password field mounted while changing groups; only explicit save/navigation clears it.
  useEffect(() => setSection(initialSection), [initialSection]);
  useEffect(
    () => setConnection(null),
    [settings.gatewayUrl, settings.caPath, keyAction],
  );
  useEffect(() => {
    setTools(null);
    setToolError("");
  }, [settings.runtimePath]);
  const disabled = !!busy,
    models = boot.models;
  const enabled = settings.agents.filter((a) => a.enabled),
    missing = enabled.filter((a) => !a.model.trim());
  const patch = (value: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...value }));
  async function catalog() {
    await onAction("models", async () => {
      setConnection(null);
      try {
        const found = await onCatalog();
        setConnection({
          ok: true,
          message: found.length
            ? `Đã kết nối · ${found.length} model`
            : "Đã kết nối · Gateway chưa cung cấp model",
          at: new Date().toISOString(),
        });
      } catch (error) {
        setConnection({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Không kết nối được gateway.",
          at: new Date().toISOString(),
        });
      }
    });
  }
  async function checkTools() {
    const path = settings.runtimePath;
    await onAction("tools", async () => {
      setToolError("");
      setTools(null);
      try {
        const reply = await window.worker.checkTools();
        if (!reply.ok) throw Error(reply.error);
        setTools({ path, values: reply.value, at: new Date().toISOString() });
      } catch (error) {
        setToolError(
          error instanceof Error ? error.message : "Không đọc được phiên bản.",
        );
      }
    });
  }
  const currentTools = tools?.path === settings.runtimePath ? tools : null;
  return (
    <section className="settings-workspace" aria-label="Cài đặt ứng dụng">
      <div className="page-heading">
        <h1>Cài đặt</h1>
        <div className="inline">
          {dirty && <span className="unsaved">Chưa lưu</span>}
          <button
            className="primary"
            disabled={!dirty || disabled}
            onClick={onSave}
          >
            {busy === "save" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            Lưu cấu hình
          </button>
        </div>
      </div>
      <div className="settings-grid setup-grid">
        <nav
          className="setup-tabs"
          role="tablist"
          aria-label="Nhóm cài đặt"
          onKeyDown={(event) => {
            const ids = Object.keys(sections) as SetupSection[];
            const index = ids.indexOf(section);
            const next =
              event.key === "ArrowRight"
                ? ids[(index + 1) % ids.length]
                : event.key === "ArrowLeft"
                  ? ids[(index + ids.length - 1) % ids.length]
                  : event.key === "Home"
                    ? ids[0]
                    : event.key === "End"
                      ? ids.at(-1)
                      : undefined;
            if (next) {
              event.preventDefault();
              setSection(next);
              document.getElementById(`setup-tab-${next}`)?.focus();
            }
          }}
        >
          {(Object.keys(sections) as SetupSection[]).map((id) => (
            <button
              key={id}
              id={`setup-tab-${id}`}
              role="tab"
              tabIndex={section === id ? 0 : -1}
              aria-selected={section === id}
              aria-controls={`setup-panel-${id}`}
              onClick={() => setSection(id)}
            >
              {sections[id]}
            </button>
          ))}
        </nav>
        <div
          id="setup-panel-models"
          role="tabpanel"
          aria-labelledby="setup-tab-models"
          hidden={section !== "models"}
        >
          <section className="card setup-card">
            <div className="setup-heading">
              <h2>Gateway</h2>
              <span className="pill">
                {boot.hasKey ? "Đã lưu key" : "Chưa có key"}
              </span>
            </div>
            <label>
              Gateway URL
              <input
                aria-label="Gateway URL"
                placeholder="https://router.example/v1"
                value={settings.gatewayUrl}
                onChange={(e) => patch({ gatewayUrl: e.target.value })}
                disabled={disabled}
                spellCheck={false}
              />
            </label>
            <label>
              API key
              <div className="input-actions">
                <input
                  ref={keyInput}
                  type="password"
                  autoComplete="new-password"
                  aria-label="API key"
                  placeholder={
                    boot.hasKey
                      ? "Để trống để giữ key đã lưu"
                      : "Nhập API key nếu gateway yêu cầu"
                  }
                  disabled={!boot.secureStorage || disabled}
                  onChange={(e) => {
                    setConnection(null);
                    setKeyAction(e.target.value ? "replace" : "keep");
                  }}
                  spellCheck={false}
                />
                {boot.hasKey && (
                  <button
                    className={keyAction === "remove" ? "danger" : ""}
                    disabled={disabled}
                    onClick={() => {
                      if (keyInput.current) keyInput.current.value = "";
                      setKeyAction(keyAction === "remove" ? "keep" : "remove");
                    }}
                  >
                    {keyAction === "remove" ? "Giữ key" : "Xóa key"}
                  </button>
                )}
              </div>
            </label>
            {keyAction === "remove" && (
              <p className="warning-text" role="status">
                Key sẽ được xóa khi lưu.
              </p>
            )}
            {!boot.secureStorage && (
              <p className="warning-text">
                Windows secure storage không khả dụng. Không thể lưu API key.
              </p>
            )}
            <details className="setup-details">
              <summary>Chứng chỉ & kết nối nâng cao</summary>
              <label>
                CA nội bộ · Tùy chọn
                <div className="input-actions">
                  <input
                    aria-label="CA nội bộ"
                    value={settings.caPath}
                    placeholder="Để trống để dùng chứng chỉ hệ thống"
                    onChange={(e) => patch({ caPath: e.target.value })}
                    disabled={disabled}
                  />
                  <button
                    aria-label="Chọn CA nội bộ"
                    onClick={() => onChooseFile("ca")}
                    disabled={disabled}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>
              <p className="muted small">
                URL gồm API prefix, thường là /v1. Đổi máy chủ cần key mới hoặc
                xóa key cũ. Key được mã hóa bằng Windows secure storage.
              </p>
              <p className="muted small">
                Source gửi trong context có thể đi qua gateway tới nhà cung cấp
                model.
              </p>
            </details>
            <div className="setup-action">
              <span className="muted small">
                {models.length
                  ? `${models.length} model trong catalog đã lưu`
                  : "Chưa có catalog"}
              </span>
              <button
                disabled={disabled || !settings.gatewayUrl.trim()}
                onClick={() => void catalog()}
              >
                {busy === "models" ? "Đang kết nối…" : "Lưu & kiểm tra kết nối"}
              </button>
            </div>
            {connection && (
              <p
                className={`notice ${connection.ok ? "" : "error"}`}
                role={connection.ok ? "status" : "alert"}
              >
                {connection.message}
                <time className="small muted">
                  {new Date(connection.at).toLocaleTimeString("vi-VN")}
                </time>
              </p>
            )}
          </section>
          <section className="card setup-card">
            <div className="setup-heading">
              <h2>Model cho agent</h2>
              <span className="pill">{enabled.length}/7 đang bật</span>
            </div>
            <p className="small muted">
              Lead ·{" "}
              {settings.agents.find((agent) => agent.role === "lead")?.model ||
                "Chưa chọn model"}
            </p>
            <div className="setup-common">
              <ModelField
                value={common}
                models={models}
                label="Model dùng chung"
                disabled={disabled}
                onChange={setCommon}
              />
              <button
                disabled={disabled || !common.trim()}
                onClick={() =>
                  setSettings((current) => applySharedModel(current, common))
                }
              >
                Dùng cho agent đang bật
              </button>
            </div>
            {missing.length > 0 && (
              <p className="warning-text small" role="status">
                Chưa chọn model: {missing.map((a) => names[a.role]).join(", ")}
              </p>
            )}
            <details className="setup-details">
              <summary>Model & trạng thái từng vai trò</summary>
              <div className="setup-agent-list">
                {settings.agents.map((agent) => (
                  <div className="setup-agent" key={agent.role}>
                    <strong>{names[agent.role]}</strong>
                    <ModelField
                      label={`Model ${names[agent.role]}`}
                      value={agent.model}
                      models={models}
                      disabled={disabled || !agent.enabled}
                      onChange={(model) =>
                        setSettings((current) => ({
                          ...current,
                          agents: current.agents.map((a) =>
                            a.role === agent.role ? { ...a, model } : a,
                          ),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="toggle"
                      role="switch"
                      aria-label={`Bật ${names[agent.role]}`}
                      aria-checked={agent.enabled}
                      disabled={agent.role === "lead" || disabled}
                      title={
                        agent.role === "lead" ? "Lead luôn bật" : undefined
                      }
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          agents: current.agents.map((a) =>
                            a.role === agent.role
                              ? { ...a, enabled: !a.enabled }
                              : a,
                          ),
                        }))
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
              </div>
            </details>
            <details className="setup-details">
              <summary>Preset theo nhiệm vụ</summary>
              <label>
                Preset
                <Select
                  aria-label="Preset model"
                  value={preset}
                  disabled={disabled}
                  onValueChange={(value) => setPreset(value as ModelPreset)}
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="quality">Quality</option>
                </Select>
              </label>
              <label>
                Model nhanh
                <ModelField
                  label="Model nhanh"
                  value={presetModels.fast}
                  models={models}
                  disabled={disabled}
                  onChange={(fast) =>
                    setPresetModels((current) => ({ ...current, fast }))
                  }
                />
              </label>
              {preset !== "fast" && (
                <label>
                  Model lập kế hoạch
                  <ModelField
                    label="Model lập kế hoạch"
                    value={presetModels.planning}
                    models={models}
                    disabled={disabled}
                    onChange={(planning) =>
                      setPresetModels((current) => ({ ...current, planning }))
                    }
                  />
                </label>
              )}
              <label>
                Model coding
                <ModelField
                  label="Model coding"
                  value={presetModels.coding}
                  models={models}
                  disabled={disabled}
                  onChange={(coding) =>
                    setPresetModels((current) => ({ ...current, coding }))
                  }
                />
              </label>
              <p className="small muted">
                BE/FE dùng model coding.{" "}
                {preset === "fast"
                  ? "Các vai trò còn lại dùng model nhanh."
                  : preset === "balanced"
                    ? "Lead/BA dùng model lập kế hoạch; còn lại dùng model nhanh."
                    : "Lead/PM/BA/TEST dùng model lập kế hoạch; DEVOPS dùng model nhanh."}{" "}
                Giữ trạng thái bật/tắt; áp dụng chỉ thay nháp.
              </p>
              <button
                disabled={
                  disabled ||
                  !presetModels.fast.trim() ||
                  !presetModels.coding.trim() ||
                  (preset !== "fast" && !presetModels.planning.trim())
                }
                onClick={() =>
                  setSettings((current) =>
                    applyModelPreset(current, preset, presetModels),
                  )
                }
              >
                Áp dụng preset
              </button>
            </details>
            <p className="muted small">
              Có thể nhập model ID ngoài catalog; cần gateway hỗ trợ ID đó.
            </p>
          </section>
          <section className="card setup-card">
            <h2>Quyền thực thi</h2>
            <p className="small">
              Bash tự động cho BE/FE/TEST/DEVOPS. Lead/PM/BA không chạy Bash.
              Câu hỏi nghiệp vụ và nghiệm thu vẫn cần phản hồi.
            </p>
            <details className="setup-details">
              <summary>Phạm vi quyền</summary>
              <p className="small muted">
                Lệnh chạy bằng tài khoản Windows hiện tại. Giới hạn lượt, scope,
                bằng chứng và nút Dừng vẫn áp dụng; đây không phải sandbox hệ
                điều hành.
              </p>
            </details>
          </section>
        </div>
        <div
          id="setup-panel-runtime"
          role="tabpanel"
          aria-labelledby="setup-tab-runtime"
          hidden={section !== "runtime"}
        >
          <section className="card setup-card">
            <h2>Runtime & công cụ</h2>
            <label>
              OpenCode executable
              <div className="input-actions">
                <input
                  aria-label="OpenCode executable"
                  value={settings.runtimePath}
                  placeholder="Tự tìm opencode trong PATH"
                  disabled={disabled}
                  onChange={(e) => patch({ runtimePath: e.target.value })}
                />
                <button
                  aria-label="Chọn OpenCode executable"
                  disabled={disabled}
                  onClick={() => onChooseFile("runtime")}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </label>
            <div className="setup-action">
              <span className="small muted">
                Cần OpenCode 1.19.5 · Chỉ đọc phiên bản, không cài công cụ.
              </span>
              <button
                disabled={
                  disabled || settings.runtimePath !== boot.settings.runtimePath
                }
                onClick={() => void checkTools()}
              >
                {busy === "tools" ? "Đang đọc…" : "Đọc phiên bản"}
              </button>
            </div>
            {settings.runtimePath !== boot.settings.runtimePath && (
              <p className="small warning-text">
                Lưu đường dẫn trước khi kiểm tra.
              </p>
            )}
            {toolError && (
              <p className="notice error" role="alert">
                {toolError}
              </p>
            )}
            {currentTools && (
              <>
                <ul className="setup-tools">
                  {currentTools.values.map((tool) => (
                    <li key={tool.name}>
                      <strong>{tool.name}</strong>
                      <span
                        className={
                          tool.available &&
                          (tool.name !== "OpenCode" ||
                            tool.version === "1.19.5")
                            ? "success-text"
                            : "warning-text"
                        }
                      >
                        {tool.available ? tool.version : "Chưa tìm thấy"}
                      </span>
                      {(!tool.available ||
                        (tool.name === "OpenCode" &&
                          tool.version !== "1.19.5")) && (
                        <small className="muted">
                          {tool.name === "OpenCode"
                            ? "Chọn OpenCode native 1.19.5 hoặc thêm vào PATH."
                            : "Chỉ cần nếu dự án dùng công cụ này."}
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="small muted">
                  Đã đọc {new Date(currentTools.at).toLocaleTimeString("vi-VN")}{" "}
                  · Chưa kiểm tra thực thi model.
                </p>
              </>
            )}
            {!currentTools && !toolError && (
              <p className="small muted">
                Chưa kiểm tra runtime với đường dẫn này.
              </p>
            )}
          </section>
          <section className="card setup-card">
            <h2>Thực thi nhóm</h2>
            <label>
              Chế độ
              <Select
                aria-label="Thực thi nhóm"
                value={settings.teamExecution ?? "sequential"}
                disabled={disabled || active}
                onValueChange={(value) =>
                  patch({ teamExecution: value as Settings["teamExecution"] })
                }
              >
                <option value="sequential">Tuần tự</option>
                <option value="isolated-pair">
                  Hai task độc lập · workspace riêng
                </option>
              </Select>
            </label>
            <p className="small muted">
              Hai task cần repo sạch; tích hợp và kiểm thử trong workspace
              riêng.
            </p>
            <details className="setup-details">
              <summary>Giới hạn lượt chạy</summary>
              <div className="limit-grid">
                <label>
                  Timeout · phút
                  <input
                    aria-label="Timeout phút"
                    type="number"
                    min={1}
                    max={240}
                    value={settings.timeoutMinutes}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({ timeoutMinutes: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Request tối đa
                  <input
                    aria-label="Request tối đa"
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.maxRequests}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({ maxRequests: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Vòng sửa lỗi
                  <Select
                    aria-label="Vòng sửa lỗi"
                    value={settings.maxFixRounds}
                    disabled={disabled}
                    onValueChange={(value) =>
                      patch({ maxFixRounds: Number(value) })
                    }
                  >
                    {[0, 1, 2].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <p className="small muted">
                Timeout và request giới hạn toàn lượt. Tối đa hai vòng sửa tự
                động.
              </p>
            </details>
          </section>
        </div>
        <div
          id="setup-panel-data"
          role="tabpanel"
          aria-labelledby="setup-tab-data"
          hidden={section !== "data"}
        >
          <section className="card setup-card">
            <h2>Dữ liệu trên máy</h2>
            <p className="small muted">
              Hội thoại, công việc và bằng chứng lưu trong dữ liệu Worker. Bỏ dự
              án khỏi danh sách không xóa source.
            </p>
            <HistoryTools active={active || disabled} onChanged={onChanged} />
          </section>
        </div>
      </div>
    </section>
  );
}
