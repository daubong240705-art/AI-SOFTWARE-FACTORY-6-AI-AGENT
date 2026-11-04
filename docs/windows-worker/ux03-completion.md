# UX-03 — Chat theo ngữ cảnh và bảo trì DB

Ngày: 05/11/2026. Baseline `d22dfd5`, checkpoint `checkpoint/ux03-start-20261105`. Giữ Worker `1.3.0-alpha.8`; schema SQLite **9**. U3-01–05 đã triển khai và kiểm chứng fixture/UI; nghiệm thu Lead qua model thật còn giới hạn bên dưới.

## Hành vi

- **Hỏi Lead** trong hồ sơ mở chat cạnh Board, gắn đúng project/công việc/revision/hội thoại. Mở từ Đội ngũ hoặc kết quả tra lại công việc của run; lịch sử run-only không tự sinh hồ sơ.
- Một ChatHost cho mỗi hội thoại, cùng textarea ở dock/toàn màn hình. Giữ nháp tiếng Việt, IME, cuộn; Board giữ bộ lọc và vị trí khi mở rộng chat. Khi ẩn, chat ngừng poll và bỏ subscription chi tiết; feed dùng lại cache hiện có.
- Chip ngữ cảnh cho phép cập nhật revision hoặc bỏ ngữ cảnh. Revision thay đổi thì từ chối gửi cho đến khi chủ động cập nhật. Đổi project/hội thoại không mang chip của công việc trước theo.
- Trạng thái phân biệt đã lưu/chờ lượt/đang giữ/đang xử lý/kết quả/lỗi. Chỉ ghi “Có phản hồi” khi có nội dung assistant; không suy ra model đã đọc.
- Request UUID lưu cùng payload đang chờ trong localStorage. SQLite nhận request, tạo run hoặc follow-up, gắn submission và lưu receipt trong một transaction. Gửi lại đúng request trả receipt cũ, kể cả sau restart; cùng ID khác payload bị từ chối. Bỏ queue lưu receipt removed, không làm sống lại yêu cầu khi retry.
- Tin nhắn queue đã có receipt không sửa tại chỗ: bỏ rồi gửi bản mới; queue cũ vẫn dùng quy tắc trước. Claim queue cập nhật receipt/run/attempt atomic. Rollback không để runtime khởi chạy run đã bị hủy transaction.

## Ngữ cảnh và dữ liệu

Run/follow-up lưu snapshot yêu cầu đúng revision. Retry/recovery giữ snapshot cũ. Context gửi model tối đa **14.000 ký tự**: body 4.000, criteria 3.500, ba ghi chú gần nhất 600 ký tự/mục và tổng 1.600, lịch sử cuối 4.000. ID run lịch sử được giữ. Ghi chú chỉ là tham khảo, không là quyết định đã duyệt; không replay lệnh từ log. Snapshot đầy đủ nằm trong DB, việc cắt context chỉ ảnh hưởng đầu vào model.

Lead profile **1.3.1** trả lời câu hỏi hiện tại, tránh lặp mô tả công việc hoặc vai trò, không tuyên bố đã sửa/test khi chưa có bằng chứng. Protocol plan/review, Full access, evidence gate, budget và một active run toàn app giữ hiệu lực. Không thêm orchestrator, dependency hoặc service.

Migration schema 8 tạo **worker.schema8.pre-chat-host.backup.sqlite** trước khi thêm `chat_requests`. Các DB cũ đi qua migration tuần tự hiện có; không xóa history/draft/settings. Retention bảo vệ run gắn hồ sơ; receipt của chat thường được xóa cùng run khi người dùng chủ động prune. Không hứa chống lặp request đã bị prune có chủ đích. Muốn rollback: đóng app, giữ bản sao dữ liệu mới, phục hồi backup cùng binary schema 8 tương thích; không ghi đè DB đang mở.

## Kiểm chứng

- Typecheck/build/Prettier/native SQLite đạt; build còn warning annotation Zod đã có.
- ChatHost acceptance dùng Electron renderer + IPC + SQLite thật: IME Enter không gửi, cùng node textarea, nháp/cuộn/bộ lọc, lỗi mất phản hồi sau commit rồi retry/double click không trùng, revision conflict/cập nhật, đóng/mở dock, đổi project, reopen dữ liệu. **4 layout**: 1366×768, 850×700, zoom 125%/150%; không lỗi renderer hoặc composer vượt dock.
- Hồi quy Work items **4 layout**, Tổng quan **5 layout**, UI foundation **5 layout** đạt. Queue được giữ trong fixture nên các kiểm tra UI không gọi provider.
- **174/174** bài toàn suite đạt. Test DB/Controller bao gồm backup schema 8, transaction rollback, request immutable, scope/revision, queue snapshot/claim/remove, restart và retention. Lần đầu phát hiện assertion version profile còn 1.3.0; cập nhật kỳ vọng đúng Lead 1.3.1 rồi chạy lại toàn suite đạt.
- Ảnh/DB/log fixture nằm trong `.cache` đã ignore, không đưa vào Git.

Chạy từ `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:native
npm run build
node scripts/run-acceptance.cjs chat-host-ui
node scripts/run-acceptance.cjs work-items-ui
node scripts/run-acceptance.cjs overview-ui
$env:ASF_UI_ARTIFACT_DIR='.cache/ux03-foundation'
node scripts/run-acceptance.cjs ui-foundation
```

**Model thật chưa nghiệm thu:** script `chat-context-live` đọc cấu hình DB chính bằng kết nối readonly, dùng project/DB riêng trong cache và một lượt Lead team chỉ trao đổi. Tiến trình riêng không giải mã được ciphertext của app, nên dừng trước provider call; không thay credentials. Có thể chạy bằng `NINE_ROUTER_API_KEY` được cung cấp qua môi trường của tiến trình, không hardcode hoặc ghi key vào báo cáo. Không coi fixture là bằng chứng chất lượng phản hồi model.

## Bảo trì DB chính

DB: `%APPDATA%\ASF Windows Worker\worker.sqlite`. Trước bảo trì không có active run hoặc queue; DB có 15 lượt terminal, 2 project, 7 hội thoại, 30 message, 661 event và 28 task. Không xóa các dữ liệu này hoặc credentials/settings.

Đã backup bằng `VACUUM INTO` tới **worker.before-cleanup-2026-11-04T20-36-40-992Z.sqlite** trong cùng thư mục, checkpoint WAL PASSIVE, optimize và VACUUM. Số trang logic **723 → 719**; quick_check `ok`, foreign_key_check không lỗi. Kích thước file chính riêng lẻ không phản ánh dung lượng trước/sau khi còn WAL, không tuyên bố tiết kiệm dung lượng lớn.

App đang mở được giữ nguyên. DB chính vẫn schema 8 trong phiên hiện tại; source mới nâng lên 9 khi mở lại bằng build mới. Không mở Store mới để migration DB đang do binary cũ sử dụng.

Lệnh xóa hàng loạt DB kiểm thử trong các thư mục `.cache` đã bị cơ chế kiểm duyệt tự động chặn, không trả lý do chi tiết; không xóa hoặc thử cách khác để vượt chặn. Các fixture tiếp tục được ignore.

## File chính và phần còn lại

- UI: `src/features/ChatHost.tsx`, compatibility re-export `ChatWorkspace.tsx`, `App.tsx`, `KanbanBoard.tsx`, `WorkItemPanel.tsx`, `FollowUpCard.tsx`, `chat.css`.
- Data/runtime: `shared/chat.ts`, `work-context.ts`, `runs.ts`, IPC contracts/channels; storage `chat-requests.ts`, `database.ts`, `board.ts`, `follow-ups.ts`; Controller `runs.ts`, main/preload.
- Prompt: `agent-profiles/lead.md`; kiểm chứng: `tests/chat.test.ts`, migration fixtures, profile version và hai script acceptance mới.

Tiếp theo UX-04 QuestionSet có cấu trúc; UX-05 reports/acceptance chưa thuộc đợt này. Chưa tuyên bố V1.3 stable hoặc nghiệm thu streaming model thật trong dock. 3D tiếp tục tạm dừng. Chưa có chức năng xóa hẳn hồ sơ/project chứa hồ sơ.
