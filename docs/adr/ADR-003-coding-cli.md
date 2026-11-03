# ADR-003 — Adapter coding CLI

Ngày: 03/11/2026. Trạng thái: chọn OpenCode cho MVP, chờ S7 trên Linux.

Chọn **OpenCode 1.19.5**, chế độ `run --pure --format json`, provider OpenAI-compatible tới `https://ai.lazy.local/v1`, alias `coding-main`. Key chỉ qua môi trường secret; CA Caddy có trong trust store image.

Chứng cứ: probe Windows đọc và sửa file `BEFORE` thành `ASF_CLI_OK\n`, artifact kiểm tra đúng, ~10.29 giây. Thử chỉ bật edit ban đầu không đủ vì cần read; policy theo role phải xét cả vòng đọc/sửa.

Codex CLI 0.166.0 đã gọi model nhưng không sửa file dù exit 0; log báo môi trường read-only và cảnh báo metadata/helper. Chưa kết luận Codex không tương thích gateway. Giữ adapter Codex tùy chọn sau khi vượt cùng acceptance test.

Adapter trả về exit code, tool events đã redaction, file diff, commit SHA, usage, version CLI và trạng thái test; không dùng lời tự báo cáo hoặc exit code làm tiêu chí duy nhất. Timeout 15 phút/task ở MVP, tối đa 2 vòng sửa lỗi trước khi blocked; concurrency chung tối đa 2 trên worker đủ tài nguyên, đặt trên máy cá nhân hoặc VM.

`coding-main` có thể đổi model upstream; lưu model thực nếu response có, kèm gateway/model profile version. Không tự áp bảng giá token hay coi cost bằng 0 của OpenCode là miễn phí.

CLI policy chỉ là lớp ứng dụng. Sandbox container/VM và network policy được nghiệm thu riêng trong S7; probe Windows không chứng minh mức cách ly production.
