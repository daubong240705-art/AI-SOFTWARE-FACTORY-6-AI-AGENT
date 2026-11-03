"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ApiError, fetchApi, User } from "@/lib/api";

type Auth = {
  user: User | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  write: <T>(path: string, body: unknown, method?: string) => Promise<T>;
};
const Context = createContext<Auth | null>(null);
export function useAuth() {
  return useContext(Context)!;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchApi<{ user: User; csrf_token: string }>(
        "/api/auth/me",
      );
      setUser(data.user);
      setCsrf(data.csrf_token);
    } catch (e) {
      setUser(null);
      setCsrf("");
      if (!(e instanceof ApiError && e.status === 401)) setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  // Initial authenticated fetch synchronizes the page with the API.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);
  useEffect(() => {
    const expired = () => {
      void reload();
    };
    window.addEventListener("asf-session-expired", expired);
    return () => window.removeEventListener("asf-session-expired", expired);
  }, [reload]);
  async function write<T>(
    path: string,
    body: unknown,
    method = "POST",
  ): Promise<T> {
    try {
      return await fetchApi<T>(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setCsrf("");
      }
      throw e;
    }
  }
  return (
    <Context.Provider value={{ user, loading, error, reload, write }}>
      {children}
    </Context.Provider>
  );
}

export function Frame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!auth.loading && !auth.user && !auth.error) router.replace("/login");
  }, [auth.loading, auth.user, auth.error, router]);
  if (auth.loading)
    return (
      <main className="auth-page">
        <p role="status">Đang xác thực phiên đăng nhập…</p>
      </main>
    );
  if (auth.error)
    return (
      <main className="auth-page">
        <ErrorBox message={auth.error} />
        <button onClick={() => void auth.reload()}>Thử lại</button>
      </main>
    );
  if (!auth.user) return null;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <div className="brand-mark">
            f<span>·</span>
          </div>
          <strong>
            AI Software
            <br />
            Factory
          </strong>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>v0.1</span>
        </div>
        <nav>
          <Link
            className={
              path === "/" ||
              path.startsWith("/projects") ||
              path.startsWith("/runs")
                ? "nav-active"
                : ""
            }
            href="/"
          >
            ◈ Dự án
          </Link>
          {auth.user.role === "admin" && (
            <Link
              className={path.startsWith("/admin") ? "nav-active" : ""}
              href="/admin/users"
            >
              ◉ Tài khoản
            </Link>
          )}
        </nav>
        <div className="sidebar-note">
          <p>{auth.user.username}</p>
          <span>{auth.user.role}</span>
          <br />
          <button
            className="logout"
            onClick={async () => {
              try {
                await auth.write("/api/auth/logout", {});
                await auth.reload();
                router.replace("/login");
              } catch {
                await auth.reload();
              }
            }}
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-top">
          <span>ĐIỀU PHỐI PHÁT TRIỂN</span>
          <span>
            {auth.user.username} · {auth.user.role}
          </span>
          <button
            className="mobile-logout"
            onClick={async () => {
              try {
                await auth.write("/api/auth/logout", {});
              } finally {
                await auth.reload();
              }
            }}
          >
            Đăng xuất
          </button>
        </header>
        <div className="workspace-content">
          <h1>{title}</h1>
          {subtitle && <p className="lead">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 20))}
      >
        ← Trước
      </button>
      <span>
        {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + 20, total)}`} /{" "}
        {total}
      </span>
      <button
        disabled={offset + 20 >= total}
        onClick={() => onChange(offset + 20)}
      >
        Sau →
      </button>
    </div>
  );
}
