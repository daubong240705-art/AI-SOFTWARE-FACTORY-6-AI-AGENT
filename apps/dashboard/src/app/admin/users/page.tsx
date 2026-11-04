"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, Frame, useAuth } from "@/components/workspace";
import { fetchApi, User } from "@/lib/api";

export default function Users() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (auth.user?.role !== "admin") return;
    try {
      setUsers((await fetchApi<{ items: User[] }>("/api/users")).items);
    } catch (e) {
      setError(String(e));
    }
  }, [auth.user]);
  // Initial authenticated fetch synchronizes the page with the API.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await auth.write("/api/users", Object.fromEntries(new FormData(form)));
      form.reset();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function update(user: User, role: string, active: boolean) {
    setBusy(true);
    setError("");
    try {
      await auth.write(`/api/users/${user.id}`, { role, active }, "PATCH");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame
      title="Tài khoản"
      subtitle="Cấp quyền truy cập cho thành viên workspace."
    >
      {auth.user?.role !== "admin" ? (
        <div className="notice">Chỉ admin được quản lý tài khoản.</div>
      ) : (
        <>
          <ErrorBox message={error} />
          <section className="panel">
            <h2>Tạo tài khoản</h2>
            <form onSubmit={create}>
              <div className="form-grid">
                <label>
                  Tên đăng nhập
                  <input
                    name="username"
                    required
                    pattern="[a-z][a-z0-9_.-]{2,39}"
                    autoComplete="off"
                    placeholder="viewer.name"
                  />
                </label>
                <label>
                  Mật khẩu (12–128 ký tự)
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <label>
                Vai trò
                <select name="role" defaultValue="viewer">
                  <option value="viewer">Viewer — chỉ xem</option>
                  <option value="approver">Approver — tạo và duyệt run</option>
                  <option value="admin">
                    Admin — quản lý tài khoản và duyệt run
                  </option>
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Tạo tài khoản
              </button>
            </form>
          </section>
          <section className="panel">
            <h2>Thành viên · {users.length}</h2>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Vai trò</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.username}
                        {u.id === auth.user?.id && " (bạn)"}
                      </td>
                      <td>
                        <select
                          aria-label={`Vai trò ${u.username}`}
                          value={u.role}
                          disabled={busy || u.id === auth.user?.id}
                          onChange={(e) =>
                            void update(u, e.target.value, !!u.active)
                          }
                        >
                          <option value="viewer">viewer</option>
                          <option value="approver">approver</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td>{u.active ? "Hoạt động" : "Đã khóa"}</td>
                      <td>
                        <button
                          disabled={busy || u.id === auth.user?.id}
                          onClick={() => void update(u, u.role, !u.active)}
                        >
                          {u.active ? "Khóa" : "Mở khóa"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </Frame>
  );
}
