# Lead chat, Hoạt động và Full access

Ngày: 04/11/2026. Baseline `ea98693` (AU-4A), checkpoint `checkpoint/lead-chat-access-20261104`, branch `feature/lead-chat-access`.

## Kết quả

Theo yêu cầu người dùng, ưu tiên ba cải tiến trải nghiệm trước khi tiếp tục lifecycle: Lead trò chuyện linh hoạt; Hoạt động gọn; Full access để không duyệt từng lệnh. Giữ Factory Lite + Windows Worker, Controller duy nhất, task tuần tự, OpenCode 1.19.5; không thêm dependency/model classifier/orchestrator hoặc sửa hạ tầng/credential.

- Trước đây team bắt buộc Lead trả plan JSON, nên “hi” thường thành `blockedReason`/Cần bổ sung. Bước quyết định nay nhận một trong hai schema strict: `{reply: string}` hoặc plan cũ. Reply hoàn thành lượt trao đổi ngay, không gọi worker/review hoặc thêm request phân loại. Prompt Lead 1.3.0 hướng dẫn chào hỏi/giải thích/trao đổi tự nhiên, hỏi phần thiếu trong hội thoại, chủ động giao việc khi đủ yêu cầu và dùng lịch sử cho câu tiếp nối. Khi có plan, giữ role/model/scope/skill/evidence gate và vòng sửa hiện có. Nhánh reply vẫn qua hậu kiểm readonly; JSON nội bộ không hiển thị vào chat.
- Hoạt động mặc định chỉ hiện task work/fix, trạng thái lệnh (tối đa năm lệnh gần nhất), lỗi cần xử lý và tiến độ Lead khi đang quyết định/review. Task không tự bung metadata. Request/session/token/raw JSON ở **Chi tiết kỹ thuật**, chỉ render log khi mở; tab Kết quả vẫn giữ bằng chứng đầy đủ. Không xóa event lưu trong DB. Nhãn composer đổi từ Lead tự phân công thành Lead.
- Thêm lựa chọn **Hỏi trước khi chạy / Full access** trong composer và Cài đặt → Runtime & công cụ. Full access đặt bash thành allow cho role có shell và doom_loop thành allow. Read/edit vẫn theo role/scope, secret/external-directory/native delegation vẫn deny; Lead/PM/BA không shell, TEST không sửa source. Shell dùng quyền Windows của người dùng, không phải sandbox hệ điều hành. Giữ Stop, deadline, request budget và vòng sửa. Không có cơ chế tự retry task mới.
- Controller có fallback tự trả lời permission bash/doom_loop hợp lệ theo settings snapshot, không hiện thẻ accept; chống trả lời hai lần cùng permission, lỗi duyệt dừng run và callback chỉ xử lý runtime tương ứng. Permission khác không được tự mở quyền. Cấu hình cũ mặc định ask, snapshot clone/normalize khi tạo run; queue cũ thiếu field vẫn so khớp được với ask. Run đã tạo không đổi mode khi settings mới được lưu. Queue khác cấu hình cần gửi lại theo policy hiện có. Schema SQLite vẫn v6.

## Kiểm chứng

| Lệnh/ca | Kết quả |
|---|---|
| `npm test` | 79/79 đạt, không skip/fail/cancel |
| `npm run typecheck` | Đạt |
| `npm run build` | Main/preload/renderer đạt |
| `npm run format:check` | Đạt |
| `npm run test:native` | Electron SQLite/safeStorage đạt; Full access và run snapshot giữ qua reopen |
| `node scripts/run-acceptance.cjs interaction-ui` | Renderer build + IPC + SQLite thật, dữ liệu tổng hợp, đạt |
| Sau guard cuối cho callback approval cũ | 11/11 execution test đạt |

Các ca mới kiểm tra hai lượt hội thoại/clarification dùng đúng history, chỉ một bước Lead; reply lẫn tasks bị từ chối và chỉ một lần schema repair; sửa source readonly vẫn bị chặn; Full access ở direct/team cho mọi role, secret/scope deny giữ nguyên; auto-approval theo run snapshot, dedup, lỗi duyệt và stopped run; settings/queue cũ, mode tồn tại sau reopen, run không đổi theo settings mới; mặc định activity không render telemetry nội bộ.

Hai lỗi fixture trong lần chạy đầu đã sửa: test mới giả định sai cột queue/API resume; expectation version Lead cũ. Không nới gate để làm xanh test.

Kiểm tra UI dùng dữ liệu riêng trong `.cache/asf-research/interaction-ui/`, không provider/key/DB của người dùng. Đã xem ảnh desktop và cửa sổ nhỏ: composer có mode quyền, activity gọn, log mở/đóng được, hội thoại reply không có task giả, không tràn ngang ở kích thước 850px. Ảnh `activity-desktop.png`, `lead-reply.png`, `composer-small.png` ở thư mục cache trên. Không commit cache/database thử. Helper Windows Computer Use không kết nối được native pipe; kiểm tra UI chuyển sang Electron capturePage trong script riêng, không điều khiển cửa sổ thật của người dùng.

**Không gọi model thật trong đợt này.** Ca hội thoại dùng output model giả lập; chứng minh dispatch/schema/persistence, không tuyên bố đã đo cách DeepSeek trả lời hoặc tốc độ/token thực. Script UI dùng response tổng hợp ghi rõ fixture. Nghiệm thu model thật và crash/process ownership vẫn thuộc các đợt tiếp theo.

## File và cách dùng

Tính từ `apps/windows-worker/`:

- Contract/defaults: `shared/contracts.ts`, `shared/defaults.ts`, `shared/team.ts`.
- Lead và runtime: `agent-profiles/lead.md`, `electron/team/{coordinator,policy}.ts`, `electron/runtime/permissions.ts`, `electron/controller/runs.ts`.
- UI: `src/App.tsx`, `src/features/{ChatWorkspace,RunPanel,ActivityLog}.tsx`, `src/styles.css`.
- Kiểm tra: `tests/{team,profiles,execution,interaction}.test.ts`, `tests/native-storage.cjs`, `scripts/acceptance-interaction-ui.cjs`, `scripts/run-acceptance.cjs`.
- Tài liệu: README sản phẩm, báo cáo này và ba file status/plan trong `plan/agent-upgrade/`.

Đóng cửa sổ bản cũ rồi chạy `npm start` trong `apps/windows-worker` để nạp main/preload/renderer mới. Giữ chế độ **Lead** để vừa trao đổi vừa giao việc. Chọn **Full access** ngay dưới ô chat trước khi gửi; lựa chọn tự lưu cùng settings lúc gửi. Trong Cài đặt cần bấm Lưu cấu hình. Mặc định cũ vẫn hỏi quyền, không tự bật Full access cho người dùng.

Rollback chức năng bằng revert phần Lead/UI/runtime nhưng giữ parser `permissionMode` và chọn ask để vẫn đọc cấu hình mới. Checkout nguyên checkpoint trên branch riêng cần bản backup cấu hình tương thích hoặc migration có chủ đích bỏ field `permissionMode` khỏi settings trên bản sao DB đã đóng; schema settings cũ là strict nên chỉ đổi giá trị thành ask chưa đủ tương thích. Giữ database/history, không tự downgrade/xóa DB đang dùng. AU-4B, WW-4D, AU-5 và WW-5 chưa hoàn thành.
