# WW-4C — Diff lịch sử và khôi phục từng file

Ngày 04/11/2026. Nhánh `feature/windows-worker-ww4c`.

Panel Thay đổi có danh sách file, unified diff với số dòng, sao chép patch và mở vị trí file trong Explorer. Hai nhóm **Trong lượt** / **Có sẵn** phân biệt thay đổi trước khi chạy với thay đổi ghi nhận giữa hai snapshot. Chọn so sánh **Trước → sau lượt**, **HEAD → index (staged)** hoặc **index → source**. Nội dung được lưu tại thời điểm chụp; mở lịch sử không lấy source hiện tại thay cho kết quả cũ.

Snapshot giữ bytes, hash và mode của source, HEAD/index hash và trạng thái Git. Blob trùng nội dung dùng chung trong SQLite. Không stash/reset/checkout hoặc ghi Git index. Thư mục chưa có Git vẫn dùng diff và khôi phục được. File thêm/xóa, UTF-8, CRLF và binary có snapshot; binary chỉ hiện thông báo, không tạo text patch. Đổi tên được liên kết bằng Git hoặc hash nội dung giống nhau, khôi phục từng đường dẫn riêng.

**Xem trước khôi phục** cho biết file sẽ trở về trạng thái nào và patch ngược. **Khôi phục file này** dùng token có hạn hai phút, kiểm tra lại project/path, hash/mode hiện tại và HEAD/index. Source mới sau lượt chạy hoặc sau preview được giữ nguyên và báo xung đột. Thao tác chỉ chạy khi toàn app rảnh, chặn tạo run trong lúc khôi phục; đóng app chờ thao tác kết thúc.

Trước thay đổi có bản dự phòng trong SQLite. File hiện tại được chuyển sang tên tạm, kiểm tra lại nội dung rồi xuất bản file khôi phục bằng hard link tạo mới có tính độc quyền trên NTFS. Không thay thế đích đang tồn tại. Nếu một editor tạo file mới trong lúc thao tác, giữ file đó và bản dự phòng để xử lý. Không đi qua symlink/junction hoặc hard link có sẵn; không tự tạo lại thư mục cha đã mất. Kiểm tra này dành cho source local tin cậy, không phải sandbox chống tiến trình độc hại thay đường dẫn liên tục.

Lệnh có CWD, timestamp bắt đầu/kết thúc, thời lượng, exit code và output. Run giữ preview 16.000 ký tự; artifact riêng giữ tối đa 256.000 ký tự sau redaction, tối đa 100 lệnh/run. Panel mở artifact và sao chép output. Lượt cũ không có timestamp/artifact vẫn đọc output đã lưu và hiển thị giới hạn rõ.

## Dữ liệu và giới hạn

- Schema6 thêm `workspace_evidence`, `workspace_blobs`, `file_recoveries`, `command_artifacts`; backup schema5 vào `worker.schema5.backup.sqlite` trước nâng cấp. Giữ nguyên lịch sử, hàng chờ và key mã hóa. Lượt cũ chỉ có danh sách file, không giả lập diff từ working tree hiện tại.
- Source tối đa 8.000 entry, 1 MB/file, 48 MB mỗi snapshot. Git lưu HEAD/index content tối đa 100 file dirty, 1 MB/file, 16 MB và khoảng 10 giây cho mỗi lần đọc nội dung. Metadata vẫn được giữ khi vượt giới hạn; UI báo snapshot giới hạn.
- Danh sách hiển thị tối đa 500 file mỗi nhóm. Text diff tối đa khoảng 500 KB, 6.000 dòng kết quả và giới hạn xử lý một giây. File lớn có thông báo; không có snapshot đầy đủ thì không khôi phục. Binary có thể khôi phục bytes sau preview thông tin.
- Bỏ dependency/build output, `.git`, `.env`, credential/certificate files và symlink. Source có mẫu credential hoặc key đã biết chỉ giữ hash, không lưu bytes để diff/restore. Các bộ lọc không thay thế việc bảo vệ source và tài khoản Windows.
- Snapshot là các lần đọc có kiểm tra thay đổi file, không phải transaction toàn bộ filesystem. Diff có thể bao gồm sửa đồng thời của người dùng; ứng dụng không gán mọi thay đổi cho agent.
- Bản dự phòng trước restore đã lưu nhưng chưa có nút phục hồi bản dự phòng riêng. Retention/export và xử lý crash giữa thao tác thuộc WW-4D; file `.asf-recovery-*.tmp` còn lại khi lỗi được giữ để bảo toàn dữ liệu. Chưa có bộ cài.

## Bằng chứng

- `npm test`: **38/38 đạt**. Các kiểm tra mới bao gồm source đã staged + sửa tiếp trước run, diff lịch sử sau reopen, restore giữ index/baseline, file thêm/xóa/rename/binary/CRLF/large/credential, xung đột sau preview, junction, migration schema5 và khóa workspace/chờ shutdown.
- `npm run typecheck`, `npm run build`, `npm run test:native`, `npm run format:check`.
- [UI acceptance](ww4c/ui-acceptance.json) chạy bản main/preload/renderer đã build, SQLite/Git/IPC thật trong fixture riêng. Kiểm tra ba loại diff, preview, từ chối thay đổi mới, restore giữ phần sửa sẵn/index, lịch sử diff sau restore, output lệnh và panel 850×700.
- Ảnh diff (`ww4c/diff-with-panel.png`, ?nh local), preview khôi phục (`ww4c/restore-preview.png`, ?nh local), cửa sổ nhỏ (`ww4c/diff-small.png`, ?nh local), bằng chứng lệnh (`ww4c/command-evidence.png`, ?nh local). Nội dung ảnh là fixture giao diện.
- [Lượt thật qua 9Router](ww4c/live-evidence.json): `ds/deepseek-v4-flash`, hai request, đọc kiểu dữ liệu sản phẩm và chạy đúng `node --version` được cho phép. Controller lưu snapshot trước/sau và artifact lệnh có CWD/thời gian/exit 0. Không sửa source hoặc shell ngoài lệnh đó.

Chạy UI: `npm run build` rồi `node scripts/run-acceptance.cjs evidence-ui`. Chạy model thật: `node scripts/run-acceptance.cjs evidence-live`, cần `NINE_ROUTER_API_KEY` trong môi trường cha. Cả hai dùng app data tạm, không thay dữ liệu app đang dùng hoặc cấu hình OpenCode global.

Tiếp theo WW-4D: local preview, quản lý process/đóng app/phục hồi crash, retention/export và resize panel.
