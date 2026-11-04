import type { ExecutionMetrics } from "../../shared/execution";
export function ExecutionFacts({
  metrics,
}: {
  metrics: ExecutionMetrics | undefined;
}) {
  if (!metrics) return <span>Số liệu chi tiết: chưa có ở lượt cũ</span>;
  return (
    <>
      <span>{metrics.requests} request</span>
      <span>
        Lệnh: {metrics.commands.passed} đạt / {metrics.commands.failed} lỗi
        {metrics.commands.incomplete
          ? ` / ${metrics.commands.incomplete} chưa xong`
          : ""}
      </span>
      <span>
        {metrics.usageSource
          ? `Token runtime: ${metrics.inputTokens ?? "?"} vào / ${metrics.outputTokens ?? "?"} ra · ${metrics.usageSteps} bước ghi nhận`
          : "Token: chưa có số liệu"}
      </span>
      <span>Chi phí: chưa có số liệu</span>
    </>
  );
}
