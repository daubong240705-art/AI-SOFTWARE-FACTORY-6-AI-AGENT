# AU-1 — Profile và policy thống nhất

Hoàn thành ngày 04/11/2026 trên nhánh `feature/agent-upgrade-au1`. Baseline `1b659c6`, checkpoint trước code `checkpoint/au1-20261104`. [Kế hoạch AU-1](../plan/agent-upgrade/implementation-plan.md).

## Vấn đề và hành vi mới

Trước đây direct chỉ chọn model theo role, không lưu/nạp profile; có lịch sử chat thì context nhận quyền edit/shell chung. Team đã có profile và quyền theo task. Kiểm tra hồi quy tái hiện direct có `profiles=[]` trước bản sửa.

Hiện tại mọi run mới lưu profile snapshot đúng role. Direct chỉ nạp role đã chọn; team vẫn nạp các role phục vụ điều phối. Cả hai dùng chung builder context/policy, giữ hướng dẫn theo role khi có hoặc không có lịch sử hội thoại.

| Role | Edit source | Shell |
|---|---|---|
| Lead / PM / BA | Từ chối | Từ chối |
| TEST | Từ chối | Hỏi quyền từng lệnh |
| BE / FE / DEVOPS | Theo phạm vi | Hỏi quyền từng lệnh |

Direct dùng phạm vi project; team dùng allowedPaths của task. Scope được chuyển về gốc Git cho monorepo. Deny credential/.git đặt sau allow scope; bổ sung deny `.pfx`/`.p12` trong thư mục con. Native delegation, external skill/MCP, external directory vẫn tắt.

OpenCodeRuntime bắt buộc nhận context đã tạo, không còn nhánh fallback quyền chung. Prompt phân biệt readonly/no-shell; direct Lead trả lời bình thường, chỉ xuất JSON plan/review khi Controller yêu cầu schema. Không thêm lượt model hoặc thay model/budget/fix limit.

Role direct chỉ đọc bị chặn trước runtime khi baseline snapshot không đầy đủ. Sau thực thi, nếu có thay đổi source hoặc không xác minh đủ snapshot, kết quả completed chuyển thành needs_input (**Cần bổ sung**), giữ diff và hàng chờ. Không tự hoàn tác file. Team tái sử dụng cùng kiểm tra source policy; thứ tự task, review và bounded fix giữ nguyên.

## Profile, skills và nguồn tham khảo

- Cập nhật bảy role profile lên `1.1.0`: scope, trả lời/handoff ngắn, bằng chứng thực tế, self-review và blocker; không tự tạo agent/reviewer.
- `fix-bug` và `testing` lên `1.1.0`, tôn trọng quyền role và kiểm tra có ý nghĩa. Role chỉ đọc không được hiểu skill fix-bug là quyền sửa source.
- Snapshot đọc version được khai báo trong profile/skill và giữ content hash; không gán mọi nội dung là `1.0.0`. Đây là phần metadata nền cho AU-3, chưa có catalog hoặc chọn skill theo task.
- Áp dụng ý tưởng role permissions của OpenCode, bàn giao/review của Superpowers và evidence/skills của ECC từ [khảo sát](../plan/agent-upgrade/research-findings.md). Không chép mã/prompt nguyên gốc, chạy script ngoài hoặc thêm dependency.

## File thay đổi

Tính từ `apps/windows-worker/`:

- Thêm `electron/team/policy.ts`: policy theo role, context từ snapshot và kiểm tra source scope/readonly.
- Thêm `electron/runtime/permissions.ts`: permission config dùng trong adapter thật, giữ thứ tự scope allow và secret deny.
- Sửa `electron/controller/runs.ts`, `electron/runtime/opencode.ts`, `electron/team/coordinator.ts`, `electron/team/profiles.ts` để sử dụng chung policy và snapshot.
- Cập nhật `agent-profiles/*.md`, `skills/fix-bug/SKILL.md`, `skills/testing/SKILL.md`.
- Thêm `tests/profiles.test.ts`; bổ sung kiểm tra snapshot direct có/không history trong `tests/runtime.test.ts`, `tests/chat.test.ts`.
- Cập nhật README gốc/Worker và trạng thái kế hoạch. Không cần thay UI: composer đã cho chọn role; mô tả cách chọn role cập nhật trong hướng dẫn sử dụng.

## Kết quả kiểm tra thực tế

Chạy tại `apps/windows-worker/`:

| Kiểm tra | Kết quả |
|---|---|
| Regression trước sửa: `tsx --test --test-name-pattern="controller locks" tests/runtime.test.ts` | Thất bại đúng mong đợi: thiếu profile BE, actual `[]` |
| Nhóm profile/runtime/team/chat sau sửa | 20/20 đạt |
| `npm run typecheck` | Exit 0 |
| `npm test` | **43/43 đạt**, không skip/fail/cancel |
| `npm run build` | Exit 0, build main/preload/renderer thành công |
| `npm run format:check` | Exit 0 |
| `git diff --check` | Không lỗi whitespace |

Năm test mới kiểm tra 7 role với/không history, direct/team parity và thiếu profile, scope monorepo/secret deny order, readonly source side effect/incomplete snapshot bằng thư mục fixture thực, version/hash profile. Test controller/chat còn kiểm tra direct snapshot được lưu vào SQLite. Test team hiện có xác minh vẫn sửa có chọn lọc, giữ attempt thất bại, cancel và giới hạn fix.

Không thêm script lint vì Worker chưa dùng linter riêng; kiểm tra định dạng bằng Prettier và typecheck bằng TypeScript. Không đổi schema/storage nên không chạy thêm native migration test. Không gọi model thật hoặc chạy acceptance sửa source sản phẩm trong AU-1; số liệu acceptance WW-2/3/4C vẫn là lịch sử, không phải kết quả mới.

## Giới hạn và mốc tiếp theo

Readonly policy chặn tool edit; shell native được người dùng cho phép vẫn chạy theo tài khoản Windows, không có OS sandbox. Snapshot là hậu kiểm, không ngăn side effect ngoài source hoặc file/thư mục bị loại khỏi snapshot. Thay đổi đồng thời bởi người dùng cũng có thể làm lượt chỉ đọc bị chặn; app giữ nguyên dữ liệu để kiểm tra.

Lịch sử cũ giữ nguyên profile/evidence cũ; không tự gán profile mới vào run đã kết thúc. Không migration DB; rollback code bằng revert commit AU-1, dữ liệu schema6 giữ tương thích.

AU-2A tiếp tục handoff có cấu trúc và xử lý truncation. Evidence reference gate thuộc AU-2B; chọn skill theo task thuộc AU-3. WW-4D/WW-5 chưa thay đổi trạng thái.
