export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  repository_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectList {
  items: Project[];
  total: number;
  limit: number;
  offset: number;
}

export interface Readiness {
  status: "ready" | "not_ready";
  checks: { database: boolean; redis: boolean; schema: boolean };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !path.startsWith("/api/auth/")
    )
      window.dispatchEvent(new Event("asf-session-expired"));
    const body = await response.json().catch(() => null);
    const code = body?.error?.message ?? "";
    const messages: Record<number, string> = {
      401: "Phiên đăng nhập hết hạn hoặc thông tin đăng nhập không đúng.",
      403: "Bạn không có quyền thực hiện thao tác này hoặc phiên cần tải lại.",
      404: "Không tìm thấy dữ liệu.",
      409: "Dữ liệu đã thay đổi hoặc đang có run hoạt động. Hãy tải lại trước khi thử tiếp.",
      429: "Đã thử đăng nhập quá nhiều lần. Vui lòng chờ 5 phút.",
    };
    if (messages[response.status])
      throw new ApiError(
        response.status,
        `${messages[response.status]} (${code})`,
      );
    if (response.status === 422)
      throw new ApiError(
        422,
        "Thông tin chưa hợp lệ. Kiểm tra lại các trường bên dưới.",
      );
    throw new ApiError(
      response.status,
      "Chưa kết nối được dịch vụ. Vui lòng thử lại.",
    );
  }
  return response.json() as Promise<T>;
}

export interface User {
  id: string;
  username: string;
  role: "viewer" | "approver" | "admin";
  active?: boolean;
}
export interface Run {
  id: string;
  project_id: string;
  requirement: string;
  status: string;
  mode: string;
  spec_version: number;
  retry_count: number;
  token_budget: number;
  call_limit: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface Artifact {
  id: string;
  kind: string;
  spec_version: number;
  content: Record<string, unknown>;
  content_hash: string;
  simulated: boolean;
}
export interface TimelineEvent {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  simulated: boolean;
  created_at: string;
}
export interface RunDetail {
  run: Run;
  tasks: {
    role: string;
    status: string;
    spec_version: number;
    simulated: boolean;
  }[];
  artifacts: Artifact[];
  approvals: {
    id: string;
    spec_version: number;
    decision: string;
    actor: string;
    comment: string;
    identity_source: string;
    created_at: string;
  }[];
  usage: {
    calls: number;
    charged_tokens: number;
    input_tokens: number | null;
    output_tokens: number | null;
  };
  model_calls: {
    id: string;
    role: string;
    model: string;
    status: string;
    latency_ms: number | null;
    charged_tokens: number;
    error_code: string | null;
  }[];
}

export const labels: Record<string, string> = {
  created: "Đã tạo",
  planning: "Đang lập kế hoạch",
  waiting_approval: "Chờ phê duyệt",
  running: "Đang chạy",
  waiting_integration: "Chờ tích hợp Agent",
  rejected: "Đã từ chối",
  failed: "Lỗi",
  cancelled: "Đã hủy",
  completed: "Hoàn thành",
  pending: "Đang chờ",
  not_implemented: "Chưa triển khai",
  blocked: "Đang bị chặn",
};
export function date(value: string) {
  return new Date(value).toLocaleString("vi-VN");
}
