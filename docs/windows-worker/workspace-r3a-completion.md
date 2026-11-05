# R3A — Trao đổi với Lead và quyền Bash theo lượt

Ngày: 05/11/2026. Worker `1.3.0-alpha.8`, SQLite 14. Baseline R2 `dc0227b`; checkpoint/kế hoạch `ee41393`. [Kế hoạch](workspace-r3-plan.md), [phương án tổng thể](../../plan/experience-loops/crewhub-workspace-redesign.md).

## Đã triển khai

- Chat mặc định gửi Lead; composer giữ người nhận và quyền thực thi. Chọn model, chế độ một agent và role ở **Tùy chọn trao đổi**, dùng dropdown riêng hiện có. Giữ nháp/IME/idempotency khi gửi lại.
- Profile Lead 1.3.3 phân biệt trao đổi/đánh giá/phương án với yêu cầu thực hiện; tiếp tục phần đã được giao, không mở rộng sang mọi đề xuất. Quyền công cụ do app xử lý, không hỏi lại mỗi lệnh trong nội dung chat.
- Tin nhắn team mới mang admission Lead. Reply/questions không tạo item/submission hay thẻ runtime Board, không tạo báo cáo nghiệm thu của công việc. Hội thoại vẫn lưu lịch sử run; report kỹ thuật vẫn đọc được nhưng không thay evidence công việc.
- Khi Lead trả plan hợp lệ, Controller hoàn tất transaction tạo/liên kết item, revision, submission, attempt và receipt trước task coding/PLAN_ACCEPTED. Retry/restart dùng lại liên kết; rollback không để lại item/counter. Câu trả lời nghiệp vụ giữ nguồn, đáp án và report gốc; continuation được liên kết khi nhận plan.
- Board/direct API và dữ liệu cũ không có marker admission giữ hành vi trước đó. Không chuyển toàn bộ chat cũ thành backlog, không sửa report bất biến hoặc DB người dùng.
- **Full access cho lượt này** xuất hiện tại yêu cầu Bash trong Chat và TaskInspector. Controller kiểm tra đúng active run, lưu audit, duyệt ticket Bash phù hợp đang chờ và tự duyệt các lệnh tiếp theo. Nếu gửi quyền thất bại, có **Duyệt quyền còn chờ** để thử lại, không ghi audit trùng. Replay ticket đã giải quyết không duyệt lần hai.
- Bật quyền theo lượt không đổi cấu hình chung hay snapshot hàng chờ. Lead/PM/BA vẫn không shell; chỉ bash/doom_loop được tự duyệt theo role policy, các gate khác giữ nguyên. Budget, scope, evidence và một active run không đổi.
- Bắt đầu dùng `WorkStateView` thuần dữ liệu tại chat/tiến độ: cần trả lời, chờ quyền, đang làm/kiểm tra, đã trả lời, có kết quả chưa xác minh, stale. Hồ sơ cập nhật submission khi plan được nhận; hàng chờ nêu đúng đích và chỉ nhận sau khi lượt hiện tại kết thúc.

## Phương án giảm hỏi Bash

1. **Cho các lượt mới:** chọn **Full access** dưới composer hoặc Cài đặt → Runtime & công cụ, rồi gửi yêu cầu. Cấu hình này lưu cho những lượt mới tiếp theo.
2. **Cho lượt đang chạy:** bấm **Full access cho lượt này** ngay tại yêu cầu Bash. Không cần dừng/gửi lại, không phải duyệt từng Bash còn lại trong lượt đó.
3. **Muốn duyệt từng lệnh:** giữ **Hỏi trước khi chạy**, dùng Cho phép/Từ chối như trước.

Không tự đổi mặc định người dùng. Full access dùng quyền tài khoản Windows hiện tại, không tạo sandbox hệ điều hành. Câu hỏi nghiệp vụ và nghiệm thu vẫn là các quyết định riêng.

## File thay đổi

Các đường dẫn dưới đây thuộc `apps/windows-worker/`:

| Nhóm | File |
|---|---|
| Lead/admission | `agent-profiles/lead.md`, `electron/controller/runs.ts`, `electron/team/coordinator.ts`, `electron/storage/database.ts`, `board.ts`, `reports.ts` |
| IPC và contract | `electron/main.ts`, `preload.ts`, `shared/channels.ts`, `contracts.ts`, `chat.ts`, `runs.ts`, `inspector.ts` |
| Projection và giao diện | Mới `shared/work-state.ts`; `src/features/ChatHost.tsx`, `FollowUpCard.tsx`, `TaskInspector.tsx`, `WorkItemPanel.tsx`, `WorkProgress.tsx`, `src/ui/Popover.tsx`, `src/chat.css` |
| Kiểm chứng | `tests/chat.test.ts`, `execution.test.ts`, `overview.test.ts`, `profiles.test.ts`, `questions.test.ts`, `reports.test.ts`; mới `scripts/acceptance-lead-access-ui.cjs`; `acceptance-chat-host-ui.cjs`, `run-acceptance.cjs` |

Tài liệu cập nhật: README Worker, README experience-loops, phương án tổng thể và bàn giao này. Không thêm dependency hoặc migration.

## Kiểm chứng

Chạy tại `apps/windows-worker`; SQLite/thư mục fixture riêng, không credential hoặc model thật.

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 233/233 đạt |
| `npm run typecheck` | Đạt |
| `npm run build` | Đạt; cảnh báo annotation Zod có từ baseline |
| Prettier source/script thay đổi và `git diff --check` | Đạt |
| `node scripts/run-acceptance.cjs lead-access-ui` | 4 layout đạt; đổi mode/model bằng custom select, reply không tạo việc, plan tạo đúng một submission, action IPC thật duyệt Bash đang chờ và Bash tiếp theo, cấu hình chung vẫn Ask |
| `node scripts/run-acceptance.cjs work-detail-ui` | 16 layout đạt; tab/draft/IME/câu hỏi/lost reply, một composer/form |
| `node scripts/run-acceptance.cjs chat-host-ui` | 4 layout đạt; nháp, revision conflict, idempotency, trao đổi không sinh submission |
| `node scripts/run-acceptance.cjs reports-ui` | 4 layout đạt; nghiệm thu, request-fix, report stale, export và artifact |
| `node scripts/run-acceptance.cjs overview-ui` | 5 layout đạt |
| `node scripts/run-acceptance.cjs workspace-shell-ui` | 4 layout đạt; không tràn ngang |

Unit/integration kiểm thêm stale ID, lỗi trả quyền/thử lại, role gate, future Bash và replay, admission trước dispatch, lỗi transaction, question continuation và report discussion không che report thực thi. Tổng 37 layout từ sáu ca UI trên; không lỗi renderer ở các lần đạt. Ba ca khởi chạy trùng build ban đầu gặp output chưa tồn tại; đã kết thúc đúng process fixture và chạy lại sau build thành công.

`lead-access-ui` nạp main/preload/renderer production và IPC/SQLite/Controller thật; chỉ thay `RunController.execute` trong module fixture bằng kịch bản xác định. Không chạy OpenCode/provider; không coi fixture này là bằng chứng model thật hiểu ý định hoặc chạy được Bash native.

Artifact chỉ local, không commit ảnh/DB:

- `.cache/r3-unit-tests.log`, `.cache/r3-build.log`
- `.cache/lead-access-ui-Sqp8kA/`
- `.cache/work-detail-ui-AF4Sup/`
- `.cache/chat-host-ui-wryaIq/`
- `.cache/reports-ui-CCsdxC/`
- `.cache/overview-ui-aQSov2/`
- `.cache/workspace-shell-ui-9rpiBP/`

Đã xem ảnh quyền Bash tại zoom 150%; các nút đọc được, vùng chat có cuộn. Đóng cửa sổ app cũ rồi chạy `npm start` để nạp main/preload mới.

## Phần còn lại

- Đây là **R3A**, chưa hoàn thành toàn bộ R3. **R3B** cần thống nhất projection/capability cho Board, Cần xử lý, Team và các view khác; nối freshness/report vào các điểm hiển thị còn thiếu. Hiện chat/tiến độ chỉ kết luận hoàn thành có xác minh khi nhận đủ report tương ứng; không suy ra từ raw completed.
- Một active run toàn app vẫn giữ. Tin nhắn trong lúc bận xếp hàng, chưa được đưa trực tiếp vào agent đang chạy. Không hứa đã chuyển yêu cầu ngay.
- Chưa đánh giá chất lượng trao đổi của profile mới bằng model thật qua 9Router; đã kiểm protocol/controller và UI bằng dữ liệu xác định.
- R4 summary/Team toàn app/Kết quả index, R6 lịch và phần 3D tiếp tục ngoài đợt này. Chưa benchmark 500 item/2.000 run hoặc usability với người dùng.
- Rollback bằng revert source của đợt R3A; không có migration phải phục hồi. Các lựa chọn quyền đã lưu trên run giữ dạng dữ liệu tùy chọn tương thích.
