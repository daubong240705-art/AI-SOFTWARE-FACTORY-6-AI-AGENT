# Cần xử lý — bàn giao

Ngày 05/11/2026. Baseline `3be8055`, checkpoint `645a5bf`. [Kế hoạch và tài liệu tham khảo](attention-plan.md). Worker giữ `1.3.0-alpha.8`, SQLite15.

## Vấn đề đã xử lý

Trước đây lỗi được liệt kê theo run; lần gửi lại độc lập của cùng công việc, yêu cầu cũ và trao đổi thiếu ngữ cảnh vẫn có thể xuất hiện. Tiêu đề lấy cả prompt nội bộ. Danh sách không giải thích hành động; mở lượt lỗi chỉ thấy trạng thái chung. Index kết quả trộn lỗi, lệnh chỉ đọc và thay đổi bàn giao.

- Inbox chọn lần thực hiện mới nhất theo công việc và retry lineage; yêu cầu khác revision hoặc đã lưu trữ không tạo cảnh báo hiện tại. Câu hỏi thật, quyền và nghiệm thu có policy vẫn lấy từ storage tương ứng. Báo cáo thất bại không tạo thêm mục chờ nghiệm thu.
- Yêu cầu bổ sung kiểu cũ chưa có task, thay đổi, lệnh hoặc bộ câu hỏi không được tính là công việc phải xử lý. Không dùng danh sách từ khóa chào hỏi để đoán ý định. Lỗi kỹ thuật của trao đổi độc lập vẫn được giữ để người dùng biết gửi yêu cầu thất bại.
- Tiêu đề dùng tên công việc và mã W khi có liên kết, bỏ markdown/prompt nhiều dòng. Dòng lỗi có loại vấn đề, task liên quan, nguyên nhân ngắn và hướng khắc phục. Home dùng cùng dữ liệu và đếm đầy đủ qua mọi trang.
- Bộ lọc dự án, **Cần quyết định / Bị chặn**, chưa đọc và cảnh báo đã đóng dùng query tại storage, giữ cursor ổn định. Dropdown dùng Select của app.
- **Đóng cảnh báo / Mở lại** chỉ áp dụng lỗi đã dừng. Không đổi run/task/report, không nghiệm thu, không duyệt quyền và không tự retry. Đã đọc độc lập với đóng. Token lỗi thay đổi làm cảnh báo xuất hiện lại; dữ liệu đóng lưu bền qua restart. Câu hỏi, quyền và review phải giải quyết bằng luồng nghiệp vụ tương ứng.
- Tiến độ và inspector dùng phép chiếu vấn đề chung: nhãn lỗi, task/role, lý do, bước tiếp theo; tiến độ có tiêu chí chưa đạt từ review. Chọn task lỗi theo lần thực hiện hiện hành, không chọn lại lỗi của task đã có bản sửa hoàn tất. Lượt lỗi có nút chính **Xem vấn đề**. Có mở task, trao đổi Lead và recovery có checkpoint hiện có; không thêm Controller hoặc tự chạy lại.
- Tiến độ chỉ bày task thực hiện hiện hành; plan/review đã kết thúc và lần thử task cũ nằm trong chi tiết thu gọn. Task chạy xong trong lượt lỗi không mang ý nghĩa công việc hoàn tất. Card căn trái và xuống dòng; dữ liệu stale vô hiệu hóa thao tác.
- Home đổi thành **Bàn giao mới**; mặc định index chỉ lấy lượt completed có thay đổi file. Tài liệu tạo thành file vẫn là bàn giao. Không tự gọi đó là đã kiểm chứng: nhãn evidence/source và nghiệm thu hiện có vẫn được giữ. Trong Kết quả, **Gồm phân tích và lượt lỗi** mở phạm vi báo cáo rộng như trước; hồ sơ công việc/lịch sử giữ mọi lần thực hiện.
- Mở inbox khác dự án đi qua chọn project hiện có để không dùng nhầm ngữ cảnh chat.

## Cơ sở lựa chọn

Tham khảo tài liệu chính thức [Jira](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/), [OpenProject](https://www.openproject.org/docs/user-guide/notifications/) và [CrewHub Loops](https://crewhub.dev/loops/): công việc sở hữu trạng thái, thông báo có vòng đời riêng, câu hỏi/review mở đúng ngữ cảnh; việc chờ người dùng đứng trước hoạt động. Đây là thiết kế riêng cho Factory Lite, không sao chép source hoặc tích hợp ba dịch vụ. CrewHub được tham khảo ở tài liệu công khai; chưa kiểm runtime/source beta.

## File chính

Trong `apps/windows-worker/`:

- `shared/attention.ts`, `shared/inbox.ts`, `shared/workspace.ts`: phép chiếu vấn đề, tiêu đề và contract lọc.
- `electron/storage/inbox.ts`, `inbox-migration.ts`, `database.ts`, `reports.ts`: chọn cảnh báo hiện hành, metadata đóng và phạm vi bàn giao.
- `electron/main.ts`, `preload.ts`, `shared/channels.ts`, `contracts.ts`: IPC đóng/mở lại có schema/token, giữ sender guard.
- `src/features/GlobalInbox.tsx`, `WorkspaceHome.tsx`, `WorkProgress.tsx`, `TaskInspector.tsx`, `WorkItemPanel.tsx`, `ProjectResults.tsx`, `src/App.tsx`: danh sách, xử lý và điều hướng.
- `src/readiness-inbox.css`, `workspace-shell.css`: toolbar, card và layout.
- `tests/inbox.test.ts`, `workspace.test.ts`: sáu test mới; các fixture migration cũ thêm drop bảng schema15 trước giả lập schema cũ.
- `scripts/acceptance-ux06-ui.cjs`, `acceptance-workspace-summary-ui.cjs`: luồng UI qua Electron/preload/IPC/SQLite thật với fixture riêng; README cập nhật cách dùng.

## Kiểm chứng

- `npm test`: **252/252 đạt**, gồm pagination/redaction, supersession/revision/archive, đọc và đóng độc lập, đóng/mở lại qua restart, invalid token, không đóng quyền/câu hỏi, bộ lọc, task sửa thay task lỗi cũ, review và schema14 backup. Sau sửa presentation cuối, nhóm inbox/workspace **15/15** vẫn đạt.
- `npm run typecheck`, `npm run build`, `npm run format:check`, `git diff --check`: đạt. Build còn warning annotation Zod có sẵn.
- `workspace-summary-ui`: 12 layout Home/Team/Kết quả, gồm 850×700, zoom125/150%; phân trang/search, chuyển phạm vi phân tích, trạng thái lỗi và ngữ cảnh chat khác dự án đạt.
- `ux06-ui`: bốn kích thước/zoom cho Team/Inbox và bốn kiểm layout tiến độ lỗi; đóng/mở lại qua IPC, lọc dự án/loại, đánh dấu đọc, câu hỏi/hàng chờ, mở đúng task lỗi và nút **Xem vấn đề** đạt.
- `work-detail-ui`: 16 layout và luồng hồ sơ/câu hỏi/nháp đạt. Không lỗi renderer trong các fixture. Đã xem ảnh inbox, Home và tiến độ ở zoom150%; toolbar không kéo dropdown chiếm từng hàng, task căn trái.

Logs, ảnh và DB fixture chỉ nằm tại `apps/windows-worker/.cache/`, không đưa Git. Các fixture không gọi provider/model và không dùng DB/credential thật. Không thực hiện dọn dữ liệu người dùng.

## Nâng cấp và giới hạn

Đóng Worker cũ, chạy `npm start` trong `apps/windows-worker` sau build. Nâng schema14 lên15 tạo `worker.schema14.pre-attention.backup.sqlite` trước khi thêm `inbox_dismissals`; migration cũ vẫn đi qua các backup tương ứng. Bản cũ từ chối schema15: muốn rollback phải đóng app và phục hồi backup có chủ đích. Không tự phục hồi DB hay xóa metadata.

Đóng cảnh báo không sửa nguyên nhân. Lỗi cũ của những trao đổi độc lập không có liên kết vẫn là những mục riêng; người dùng có thể đóng từng cảnh báo. Không đoán cùng công việc bằng tiêu đề tương tự hoặc tự gộp các trao đổi khác nhau. Phạm vi lịch sử báo cáo vẫn gộp theo công việc/retry như index cũ; để xem từng lần dùng hồ sơ/Lịch sử. Báo cáo chỉ trả lời bằng chữ, không có file thay đổi, nằm ngoài mặc định bàn giao. Không benchmark DB rất lớn hoặc gọi model thật trong đợt này. R6 lịch và 3D không thuộc thay đổi này.
