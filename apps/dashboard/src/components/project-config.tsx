"use client";
import { FormEvent, useEffect, useState } from "react";
import { fetchApi, Project } from "@/lib/api";
import { ErrorBox, useAuth } from "./workspace";

interface Configuration {
  models: string[];
  default_model: string;
  profiles: { id: string; name: string }[];
}
const roles = ["pm", "ba", "be", "fe", "test", "devops"];

export function ProjectConfig({
  project,
  reload,
}: {
  project: Project;
  reload: () => Promise<void>;
}) {
  const auth = useAuth();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetchApi<Configuration>("/api/configuration")
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await auth.write(
        `/api/projects/${project.id}`,
        {
          name: project.name,
          slug: project.slug,
          description: project.description,
          repository_url: project.repository_url,
          integration_profile: form.get("profile") || null,
          agent_models: Object.fromEntries(
            roles.map((role) => [role, form.get(role)]),
          ),
        },
        "PATCH",
      );
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Agent và tích hợp</h2>
      <ErrorBox message={error} />
      {config && (
        <form onSubmit={save} key={project.updated_at}>
          <label>
            Kết nối dự án
            <select
              name="profile"
              defaultValue={project.integration_profile ?? ""}
              disabled={auth.user?.role !== "admin"}
            >
              <option value="">Chỉ lập kế hoạch và đặc tả</option>
              {config.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            {roles.map((role) => (
              <label key={role}>
                Model {role.toUpperCase()}
                <select
                  name={role}
                  defaultValue={
                    project.agent_models[role] ?? config.default_model
                  }
                  disabled={auth.user?.role !== "admin"}
                >
                  {config.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="muted">
            Model được cố định khi tạo run. PM/BA và BE/FE gọi model;
            TEST/DEVOPS thực thi kiểm tra và gate theo quy tắc. Chỉ các model đã
            được quản trị cho phép mới xuất hiện.
          </p>
          {auth.user?.role === "admin" && (
            <button disabled={busy} className="primary">
              {busy ? "Đang lưu…" : "Lưu cấu hình"}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
