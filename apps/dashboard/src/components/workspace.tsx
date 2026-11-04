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
          <span className="brand-mark">A</span>
          <strong>AI Factory</strong>
        </Link>
        <div className="workspace-label">Workspace</div>
        <nav aria-label="Điều hướng">
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
            <NavIcon kind="projects" /> Dự án
          </Link>
          {auth.user.role === "admin" && (
            <Link
              className={path.startsWith("/admin/users") ? "nav-active" : ""}
              href="/admin/users"
            >
              <NavIcon kind="users" /> Tài khoản
            </Link>
          )}
          {auth.user.role === "admin" && (
            <Link
              className={path.startsWith("/admin/agents") ? "nav-active" : ""}
              href="/admin/agents"
            >
              <NavIcon kind="agents" /> Agent & worker
            </Link>
          )}
        </nav>
        <div className="sidebar-note">
          <div className="account">
            <span className="avatar">
              {auth.user.username[0].toUpperCase()}
            </span>
            <div>
              <strong>{auth.user.username}</strong>
              <small>{auth.user.role}</small>
            </div>
          </div>
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
          <h1>{title}</h1>
          <span className="top-account">
            {auth.user.username}
            <span className="status">{auth.user.role}</span>
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
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}

function NavIcon({ kind }: { kind: "projects" | "users" | "agents" }) {
  const paths = {
    projects: "M3 7h6l2 2h10v10H3z M3 7V5h6l2 2",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
    agents:
      "M8 3v3 M16 3v3 M8 18v3 M16 18v3 M3 8h3 M3 16h3 M18 8h3 M18 16h3 M6 6h12v12H6z M10 10h4v4h-4z",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
      {kind === "users" && <circle cx="9" cy="7" r="4" />}
    </svg>
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
