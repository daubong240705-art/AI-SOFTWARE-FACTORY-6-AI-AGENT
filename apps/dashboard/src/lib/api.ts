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
    if (response.status === 409)
      throw new ApiError(409, "Mã dự án đã tồn tại. Hãy chọn một mã khác.");
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
