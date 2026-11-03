"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBox, useAuth } from "@/components/workspace";
import { fetchApi } from "@/lib/api";

export default function Login() {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (auth.user) router.replace("/");
  }, [auth.user, router]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      await fetchApi("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      form.reset();
      await auth.reload();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng nhập thất bại");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="login-card">
        <div className="eyebrow">AI SOFTWARE FACTORY</div>
        <h1>Trở lại workspace.</h1>
        <p className="lead">Đăng nhập để theo dõi và điều phối dự án.</p>
        <ErrorBox message={error || auth.error} />
        <form onSubmit={submit}>
          <label>
            Tài khoản
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={40}
            />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Đang đăng nhập…" : "Đăng nhập →"}
          </button>
        </form>
        <p className="muted">
          Tài khoản do quản trị viên cấp. Không có đăng ký công khai.
        </p>
      </div>
    </main>
  );
}
