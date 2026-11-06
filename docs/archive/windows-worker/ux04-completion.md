# UX-04 — Câu hỏi nghiệp vụ và lượt tiếp nối

Ngày: 05/11/2026. Baseline `dd9ada3`, checkpoint `checkpoint/ux04-start-20261105`. Worker giữ `1.3.0-alpha.8`, SQLite **10**, Lead profile **1.3.2**. Đã triển khai U4-01–05 và kiểm chứng bằng SQLite, Electron UI và DeepSeek Flash qua 9Router.

## Cách sử dụng

Lead dùng bộ câu hỏi khi thiếu quyết định nghiệp vụ quan trọng trước khi thực hiện. Trong Chat có các lựa chọn, dấu **Đề xuất**, ô nhập tự do và nhãn **Bắt buộc / Tùy chọn**. Khuyến nghị không được chọn sẵn. Có thể dùng lựa chọn cùng phần bổ sung, bỏ lựa chọn để chỉ trả lời tự do, hoặc bỏ trống câu tùy chọn. Bấm **Gửi câu trả lời** một lần cho cả nhóm.

Nháp câu trả lời lưu trên máy theo bộ câu hỏi, khôi phục sau restart. Khi có lỗi xung đột phiên bản, nháp trên màn hình được giữ; **Tải lại phiên bản** đối chiếu dữ liệu mới, không âm thầm ghi đè đáp án của phiên khác. Bộ cũ/đã trả lời thu gọn, mở để xem lịch sử. Bộ mới xuất hiện được đưa vào vùng nhìn thấy, sau đó chuyển dock/toàn màn hình giữ textarea và nội dung.

Tổng quan có mục **Cần trả lời**, mở thẳng chat tương ứng. Bộ đã trả lời hoặc đã thay thế không giữ mục “Cần bổ sung” trùng lặp. Lỗi needs_input cũ không có QuestionSet vẫn dùng hành vi cũ. Full access tiếp tục áp dụng cho tool; câu hỏi nghiệp vụ không tự được trả lời vì bật Full access.

## Protocol và vòng đời

- Nhánh mới `{version:1, kind:"questions", summary, questions}` là envelope strict, không kèm tasks/reply/blockedReason. Parser giữ reply/plan cũ; không suy ra câu hỏi bằng regex từ văn bản.
- Tối đa **6 câu**, **0–4 lựa chọn/câu**, ID trong bộ không trùng; tối đa một đề xuất/câu. Mọi câu cho nhập tự do tối đa **3.000 ký tự**. Title 300, label 160, description 300, summary 1.200 ký tự.
- Controller gắn project/conversation/source run và work item/revision từ dữ liệu thật. Board submission cũ không có run.workContext vẫn lấy revision từ work_attempts/submissions.
- Lead trả questions thì source run kết thúc needs_input, không dispatch worker. Chỉ publish bộ câu hỏi khi ghi terminal needs_input + needs-context + endedAt; ghi lại cùng event/run không tạo bộ trùng. Không tạo lại bộ từ lịch sử khi migration/restart.
- Bộ có trạng thái **pending / answered / superseded** và recordVersion riêng với protocol version. Run mới trong cùng hội thoại thay thế bộ đang chờ; sửa revision hoặc archive vô hiệu hóa bộ cũ trước lần đọc/gửi tiếp. Không tự phục hồi bộ bị thay thế khi đổi yêu cầu trở lại.
- Submit validate identity/project/conversation/version, câu bắt buộc và option ID. Câu trả lời chuẩn hóa cùng receipt tạo bởi ChatSend của UX-03 nằm trong **một SQLite transaction**. UUID bộ câu hỏi là requestId tiếp nối; không thêm orchestrator/outbox khác.
- Khi rảnh và queue trống: tạo run mới. Khi có run/queue: lưu follow-up theo policy hiện có; held vẫn cần **Chạy tiếp**. Source needs_input giữ nguyên; không resume session đã kết thúc. Snapshot requirement gắn revision lúc người dùng trả lời, queue không tự chuyển revision khi editor đổi sau đó.
- Double submit, response lost, reload hoặc replay cùng đáp án trả receipt đã lưu. Thứ tự đáp án được chuẩn hóa; đáp án khác sau khi submit bị từ chối. Xóa continuation khỏi queue giữ receipt removed, gửi lại không làm sống lại yêu cầu. Claim queue cập nhật receipt sang run thật.
- Lỗi giữa tạo run/queue và ghi answered rollback toàn bộ; Controller phục hồi active pointer nên run đã rollback không được gọi model. Stop/Full access/evidence gate và global active-run lock giữ nguyên.

Prompt tiếp nối chứa ID bộ/source run, câu hỏi và đáp án đã chấp nhận. Yêu cầu gốc tối đa 6.000 ký tự, ghi nhãn khi rút gọn; không coi đáp án là cấp quyền mới hoặc replay lệnh. Ngữ cảnh công việc tiếp tục dùng builder bounded của UX-03.

## Dữ liệu và migration

Schema **10** thêm `question_sets`, unique theo source run, FK tới run/conversation/work item, index theo conversation và project/state. DB schema 9 được backup thành **worker.schema9.pre-questions.backup.sqlite** trước migration. Nếu đi từ schema 8 trở xuống, chuỗi migration giữ backup tương ứng phiên bản gốc; không tạo bản backup giả mang nhãn schema 9. Giữ history/draft/settings/ciphertext, không chạy lại các run cũ.

Chat trả tối đa **20 bộ gần nhất/hội thoại**, Tổng quan tối đa **50 bộ pending/project**. Không quét/poll UI nhiều project để làm inbox. Lịch sử cũ vẫn trong DB; export từng run lấy chính xác bộ của run đó kể cả ngoài 20 bộ chat. Retention bảo vệ source và continuation run; prune kiểm tra lại refs trước khi xóa. Project có lịch sử câu hỏi chưa được xóa hẳn khỏi danh sách.

Không nâng DB chính đang do app cũ mở trong đợt này. Khi mở lại bằng build mới, migration chạy tự động. Rollback: đóng app, giữ bản sao dữ liệu mới, phục hồi backup và dùng binary tương thích schema của backup. Không mở schema 10 bằng binary cũ.

## Kiểm chứng thực tế

- **182/182** bài toàn suite đạt, gồm **8 bài mới**: strict/legacy parser, coordinator dừng trước worker, scope/required/free text, draft/restart/conflict, atomic rollback, replay/queue removal, revision/snapshot/claim, inbox resolution, migration backup/credentials, idle continuation/stop và retention/export vượt trang chat.
- Typecheck, build, Prettier và SQLite native/Windows secure storage đạt. Build còn warning annotation Zod đã có.
- Acceptance mới dùng production main/preload/renderer, SQLite thật và migration schema 9 populated. Kiểm tra không preselect, required, nháp tiếng Việt qua renderer reload, Full access, response lost/double submit/replay, inbox refresh và stale revision. **4 cấu hình cửa sổ**, cả dock và fullscreen: 1366×768, 850×700, zoom 125% và 150%; cùng textarea, không tràn ngang hoặc che composer, không lỗi renderer.
- Hồi quy ChatHost **4**, Tổng quan **5**, Work items **4**, UI foundation **5 cấu hình** và Electron native đạt. UI fixtures giữ queue để không gọi provider.
- **Model thật:** `ds/deepseek-v4-flash` qua 9Router, một request tạo QuestionSet pending đúng công việc W-0001/revision 1; gửi đáp án tạo một continuation, replay cùng đáp án trả cùng runId; một request tiếp theo trả lời đúng lựa chọn và kết thúc completed. Cả hai lượt không dispatch worker, không command hoặc thay đổi file. Bằng chứng tổng hợp: [ux04-live.json](ux04-live.json).
- Harness live ban đầu đặt DB trong source fixture làm snapshot tự thấy WAL thay đổi; đã tách source/data trước lần đạt. Credentials hiện giải mã được trong tiến trình kiểm thử; không thay key/settings của app. Nghiệm thu live này cũng bổ sung bằng chứng ngữ cảnh + phản hồi tự nhiên còn thiếu của UX-03; chưa thay cho nghiệm thu streaming trong dock.

Chạy từ `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:native
npm run build
node scripts/run-acceptance.cjs questions-ui
node scripts/run-acceptance.cjs chat-host-ui
node scripts/run-acceptance.cjs overview-ui
node scripts/run-acceptance.cjs work-items-ui
$env:ASF_UI_ARTIFACT_DIR='.cache/ux04-foundation'
node scripts/run-acceptance.cjs ui-foundation
node scripts/run-acceptance.cjs chat-context-live --questions
```

Lệnh cuối gọi model thật, đọc cấu hình DB chính readonly và tạo project/data riêng trong cache. Có thể dùng `NINE_ROUTER_API_KEY` của tiến trình nếu không giải mã được key đã lưu; không hardcode key. Ảnh, DB và log chỉ trong `.cache` đã ignore, không đưa lên Git.

## Phạm vi và bước tiếp theo

File chính: `shared/questions.ts`, `team.ts`, `chat.ts`, `overview.ts`; storage `questions.ts`, `database.ts`; coordinator/Controller; main/preload/contracts/channels; UI `QuestionCards.tsx`, `ChatHost.tsx`, `ProjectOverview.tsx`, `App.tsx`, `chat.css`; Lead profile; test Questions và fixture migration cũ; acceptance UI/live.

Chưa có nhiều người dùng đồng thời, duyệt câu trả lời sau khi submit, phân trang UI cho hơn 20 bộ, xóa hẳn lịch sử câu hỏi, hoặc báo cáo/acceptance bất biến của UX-05. Model có thể hỏi lại điều đã trả lời; prompt hướng dẫn tránh lặp nhưng không tuyên bố bảo đảm trên mọi model. Không sửa ngoài phạm vi Factory Lite + Windows Worker, không thêm dependency/service; 3D tiếp tục tạm dừng. Tiếp theo **UX-05 — Kết quả, báo cáo và nghiệm thu tùy chọn**.
