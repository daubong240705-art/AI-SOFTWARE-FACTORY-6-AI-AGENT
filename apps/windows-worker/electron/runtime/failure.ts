import type { ExecutionFailure, FailureCode } from "../../shared/execution";
import { redact } from "./security";

export function failure(
  code: FailureCode,
  message: string,
  secrets: string[] = [],
): ExecutionFailure {
  return {
    code,
    message: redact(message, secrets, 1600),
    retry: [
      "transient",
      "rate-limit",
      "interrupted",
      "tool-test-failure",
      "invalid-output",
    ].includes(code)
      ? "manual"
      : "none",
  };
}
export class WorkerError extends Error {
  constructor(readonly failure: ExecutionFailure) {
    super(failure.message);
  }
}
export function classifyFailure(
  error: unknown,
  secrets: string[] = [],
): ExecutionFailure {
  if (error instanceof WorkerError)
    return failure(error.failure.code, error.message, secrets);
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (JSON.stringify(error) ?? "Runtime thất bại.");
  const text = redact(raw, secrets, 1600);
  const code: FailureCode = /request_limit|hết số request/i.test(text)
    ? "budget-exhausted"
    : /hết thời gian|deadline/i.test(text)
      ? "deadline-exceeded"
      : /authentication|ProviderAuth|\b401\b|\b403\b|xác thực/i.test(text)
        ? "provider-auth"
        : /\b429\b|rate.?limit|giới hạn request/i.test(text)
          ? "rate-limit"
          : /permission.*(denied|reject)|quyền.*từ chối/i.test(text)
            ? "permission-denied"
            : /ngoài phạm vi|scope.violation/i.test(text)
              ? "scope-violation"
              : /snapshot.*(không đầy đủ|chưa đủ)|Không thể xác minh toàn bộ/i.test(
                    text,
                  )
                ? "incomplete-snapshot"
                : /TLS|certificate|network|fetch failed|ECONN|ETIMEDOUT|Gateway HTTP 5\d\d|kết nối.*gateway/i.test(
                      text,
                    )
                  ? "transient"
                  : /schema|JSON không hợp lệ|báo cáo cuối|tool-calls/i.test(
                        text,
                      )
                    ? "invalid-output"
                    : /command evidence|lệnh.*thất bại|lệnh.*exit code/i.test(
                          text,
                        )
                      ? "tool-test-failure"
                      : /Thiếu.*(profile|catalog|skill)|snapshot skill|không.*opencode|chưa được hỗ trợ|chưa.*model|chưa bật|cấu hình/i.test(
                            text,
                          )
                        ? "configuration"
                        : "runtime";
  return failure(code, text);
}
