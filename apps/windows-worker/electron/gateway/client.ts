import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { z } from "zod";
import type { Settings } from "../../shared/contracts";

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(200) })).max(10000),
});

export async function fetchModels(
  settings: Settings,
  apiKey: string | undefined,
): Promise<string[]> {
  if (!settings.gatewayUrl) throw new Error("Nhập và lưu Gateway URL trước.");
  const url = new URL(settings.gatewayUrl.replace(/\/+$/, "") + "/models");
  let ca: string[] | undefined;
  if (settings.caPath) {
    try {
      const content = await readFile(settings.caPath, "utf8");
      if (
        content.length > 1024 * 1024 ||
        !content.includes("-----BEGIN CERTIFICATE-----")
      )
        throw new Error();
      ca = [...rootCertificates, content];
    } catch {
      throw new Error("Không đọc được chứng chỉ CA dạng PEM.");
    }
  }
  const body = await new Promise<string>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        ...(url.protocol === "https:" ? { ca, rejectUnauthorized: true } : {}),
      },
      (response) => {
        // Do not follow redirects with Authorization headers.
        if (response.statusCode !== 200) {
          response.resume();
          const status = response.statusCode;
          reject(
            new Error(
              status === 401 || status === 403
                ? "Gateway từ chối API key hoặc quyền truy cập."
                : status === 404
                  ? "Không tìm thấy /models. Gateway URL cần bao gồm API prefix, ví dụ /v1."
                  : status === 429
                    ? "Gateway đang giới hạn request. Thử lại sau."
                    : `Gateway trả HTTP ${status ?? "không xác định"}.`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            request.destroy(new Error("Danh sách model vượt giới hạn 2 MB."));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        response.on("error", () =>
          reject(new Error("Kết nối gateway bị gián đoạn.")),
        );
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Gateway không phản hồi trong 15 giây.")),
      15000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code?.includes("CERT") ||
          error.code?.includes("SELF_SIGNED") ||
          error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
            ? "Chứng chỉ TLS không được tin cậy. Chọn đúng CA nội bộ."
            : error.message === "Gateway không phản hồi trong 15 giây." ||
                error.message === "Danh sách model vượt giới hạn 2 MB."
              ? error.message
              : "Không kết nối được gateway. Kiểm tra URL và mạng.",
        ),
      ),
    );
    request.end();
  });
  try {
    return [
      ...new Set(
        catalogSchema.parse(JSON.parse(body)).data.map((model) => model.id),
      ),
    ].sort();
  } catch {
    throw new Error(
      "Gateway trả danh sách model không đúng định dạng OpenAI-compatible.",
    );
  }
}
