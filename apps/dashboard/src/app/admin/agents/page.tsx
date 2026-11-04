"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, Frame, Pager, useAuth } from "@/components/workspace";
import { date, fetchApi } from "@/lib/api";

type Worker = {
  id: string;
  name: string;
  active: boolean;
  capabilities: string[];
  status: string;
  last_seen_at: string | null;
  executions: { id: string; run_id: string; role: string; lease_until: string }[];
};
type WorkerList = { items: Worker[]; total: number };
type Grant = { id: string; name: string; token: string };
type Capabilities = {
  roles: Record<string, { id: string; version: number; sha256: string; tools: string[]; instructions: string }>;
  models: string[];
  coding_limits: { requests: number; tokens: number; output_tokens: number };
};
const statusLabels: Record<string, string> = {
  online: "Online", offline: "Offline", never_connected: "Chưa kết nối", revoked: "Đã thu hồi",
};

export default function Agents() {
  const auth = useAuth();
  const [workers, setWorkers] = useState<WorkerList>({ items: [], total: 0 });
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [copied, setCopied] = useState(false);
  const isAdmin = auth.user?.role === "admin";
  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [list, catalog] = await Promise.all([
        fetchApi<WorkerList>(`/api/coding-workers?limit=20&offset=${offset}`),
        fetchApi<Capabilities>("/api/agent-capabilities"),
      ]);
      setWorkers(list);
      setCapabilities(catalog);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, offset]);
  useEffect(() => {
    // Initial fetch and polling synchronize worker heartbeat status with the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!isAdmin) return;
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load, isAdmin]);
  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const value = await auth.write<Grant>("/api/coding-workers", {
        name: data.get("name"), capabilities: data.getAll("capabilities"),
      });
      setGrant(value);
      setCopied(false);
      form.reset();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function change(worker: Worker, action: "rotate" | "revoke") {
    setBusy(true);
    setError("");
    try {
      if (action === "rotate") {
        const value = await auth.write<Grant>(`/api/coding-workers/${worker.id}/rotate`, {});
        setGrant(value);
        setCopied(false);
      } else {
        await auth.write(`/api/coding-workers/${worker.id}`, {}, "DELETE");
        if (grant?.id === worker.id) setGrant(null);
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Agent & worker" subtitle="Quản lý thiết bị thực thi và xem cấu hình năng lực agent.">
      {!isAdmin ? <div className="notice">Chỉ admin được quản lý agent và worker.</div> : <>
        <ErrorBox message={error} />
        {grant && <section className="panel" aria-label="Token worker mới">
          <h2>Token · {grant.name}</h2>
          <p>Token chỉ hiển thị lần này. Lưu vào ASF_WORKER_TOKEN trong file cấu hình riêng của worker. Đổi token sẽ vô hiệu hóa token cũ ngay.</p>
          <label>Token<input readOnly value={grant.token} autoComplete="off" spellCheck={false} /></label>
          <div className="actions">
            <button disabled={busy} onClick={async () => {
              try { await navigator.clipboard.writeText(grant.token); setCopied(true); }
              catch { setError("Không sao chép được. Hãy sao chép trực tiếp từ ô token."); }
            }}>{copied ? "Đã sao chép" : "Sao chép"}</button>
            <button onClick={() => setGrant(null)}>Đã lưu · Ẩn token</button>
          </div>
        </section>}
        <section className="panel">
          <h2>Đăng ký worker</h2>
          <p className="muted">Worker Linux/WSL2 cần Docker và chủ động kết nối HTTPS về ASF. Máy cá nhân có thể offline; lease hết hạn sẽ được thu hồi theo giới hạn của run.</p>
          <form onSubmit={register}>
            <label>Tên thiết bị<input name="name" required pattern="[a-z0-9-]{1,80}" maxLength={80} placeholder="worker-vm60" /></label>
            <fieldset>
              <legend>Vai trò nhận việc</legend>
              <div className="worker-roles">{["be", "fe", "test", "devops"].map(role => <label key={role}>
                <input type="checkbox" name="capabilities" value={role} defaultChecked />{role.toUpperCase()}
              </label>)}</div>
            </fieldset>
            <button className="primary" disabled={busy || !!grant}>Đăng ký và cấp token</button>
          </form>
        </section>
        <section className="panel">
          <div className="actions"><h2>Worker · {workers.total}</h2><button disabled={busy} onClick={() => void load()}>Làm mới</button></div>
          <p className="muted">Online: có heartbeat hoặc poll trong 120 giây gần nhất. Tự cập nhật mỗi 15 giây. Đổi/thu hồi token làm worker đang chạy mất quyền heartbeat và dừng công việc.</p>
          {loading ? <p role="status">Đang tải worker…</p> : workers.items.length === 0 ? <p>Chưa có worker trong trang này.</p> :
            <div className="table-scroll"><table><thead><tr><th>Thiết bị</th><th>Trạng thái</th><th>Vai trò</th><th>Đang thực thi</th><th>Thao tác</th></tr></thead><tbody>
              {workers.items.map(worker => <tr key={worker.id}>
                <td>{worker.name}</td>
                <td>{statusLabels[worker.status] ?? worker.status}<br /><small>{worker.last_seen_at ? date(worker.last_seen_at) : "Chưa nhận heartbeat"}</small></td>
                <td>{worker.capabilities.join(", ").toUpperCase()}</td>
                <td>{worker.executions.length === 0 ? "—" : worker.executions.map(item => <div key={item.id}><Link href={`/runs/${item.run_id}`}>{item.role.toUpperCase()} · {item.id.slice(0, 8)}</Link></div>)}</td>
                <td><div className="actions"><button disabled={busy || !worker.active || !!grant} onClick={() => void change(worker, "rotate")}>Đổi token</button><button disabled={busy || !worker.active} onClick={() => void change(worker, "revoke")}>Thu hồi</button></div></td>
              </tr>)}
            </tbody></table></div>}
          <Pager offset={offset} total={workers.total} onChange={setOffset} />
        </section>
        {capabilities && <section className="panel">
          <h2>Model & kỹ năng theo role</h2>
          <p>Model được quản trị cho phép: <strong>{capabilities.models.join(", ")}</strong>. Chọn model cho từng role tại cấu hình dự án; run giữ nguyên snapshot khi được tạo.</p>
          <p>BE/FE: tối đa {capabilities.coding_limits.requests} request ra gateway cho mỗi execution, ngân sách {capabilities.coding_limits.tokens.toLocaleString()} đơn vị token, tối đa {capabilities.coding_limits.output_tokens.toLocaleString()} output token/request. Usage thiếu được tính bảo thủ. API key thật được giữ ngoài sandbox.</p>
          <p className="muted">TEST chạy bộ test tin cậy; DEVOPS xác minh CI, approval và health theo quy tắc. Catalog là cấu hình cho phép, chưa chứng minh model mới đã vượt kiểm tra năng lực.</p>
          {Object.entries(capabilities.roles).map(([role, skill]) => <details key={role}>
            <summary>{role.toUpperCase()} · {skill.id} v{skill.version} · {skill.tools.join(", ") || "Đầu ra JSON có schema"}</summary>
            <p>{skill.instructions}</p><small>SHA256: {skill.sha256}</small>
          </details>)}
        </section>}
      </>}
    </Frame>
  );
}
