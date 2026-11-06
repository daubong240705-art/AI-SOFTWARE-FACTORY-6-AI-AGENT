# WW-4A — Giao diện hội thoại

Ngày 04/11/2026. Nhánh `feature/windows-worker-ww4-chat`.

Màn hình chính chuyển sang chat: project/phiên ở sidebar, transcript ở giữa, composer cố định dưới và panel nhiệm vụ/thay đổi/kết quả ở phải. Giữ Segoe UI, màu cam nhẹ, bỏ cột team và các mô tả dài khỏi workspace chính. Team đầy đủ nằm trong Cài đặt. Chọn Lead/Một agent/role/model ngay ở composer; nút gửi/dừng và thẻ quyền shell dùng Controller thật.

Có tạo phiên, đổi tên, tìm kiếm có/không dấu, nháp riêng, Markdown/code block/copy, cuộn theo tin mới và phân trang 60 tin nhắn. Panel thành overlay ở vùng hẹp. Markdown bỏ raw HTML và ảnh từ xa; mở liên kết HTTP/HTTPS chỉ qua thao tác người dùng và IPC kiểm tra URL. Renderer tiếp tục không có Node integration.

## Dữ liệu và ngữ cảnh

Schema4 thêm `conversations`/`messages`. Migration từ schema3 có backup nhất quán, chuyển **mọi** run cũ, kể cả ngoài 50 run gần nhất và project đã bỏ khỏi danh sách, giữ ID/timestamps/evidence; nháp project cũ thành phiên nháp riêng. Tạo run và hai message user/assistant trong cùng transaction. Phản hồi và trạng thái lỗi/hủy/crash đồng bộ về đúng tin nhắn. Lỗi migration đóng DB và giữ lỗi, không tiếp tục với dữ liệu dở dang.

Lượt nhắn tiếp lấy tối đa bốn lượt trước, giới hạn nội dung rồi snapshot vào run. Context chỉ là dữ liệu tham khảo, không tự chạy lại lệnh. Mỗi lần gửi tạo baseline/budget/session mới. Không gửi toàn bộ log hoặc reasoning.

## Bằng chứng

- Ảnh desktop (`ww4a/chat-desktop.png`, ảnh local), có panel (`ww4a/chat-with-panel.png`, ảnh local), cửa sổ nhỏ (`ww4a/chat-small.png`, ảnh local).
- [UI acceptance](ww4a/ui-acceptance.json): chạy bản main/preload/renderer đã build, SQLite/IPC thật trong app data tạm. Kiểm tra đổi phiên giữ nháp, polling/panel không ghi đè draft, rename, layout 850×700 không tràn ngang và renderer không Node. Transcript ảnh là fixture UI dựa trên kết quả WW-3, không phải lượt model mới.
- [Hai lượt model thật](ww4a/live-chat.json): `ds/deepseek-v4-flash` qua 9Router, hai run trong một conversation; lần đầu 2 request, lần sau 1 request. Lượt sau nhắc lại đúng marker chỉ xuất hiện trong lượt đầu; context tham chiếu đúng run trước. Bốn message lưu đúng, không có thay đổi source hay lệnh shell.
- `npm run typecheck`, `npm test` (**27/27**), `npm run test:native`, `npm run build`.
- Test migration giữ 65 run cũ, timestamps/ciphertext/draft; paging không mất thứ tự; chặn nối nhầm project; lưu trạng thái cancelled và context mà không replay.

Chạy lại UI: `npm run build` rồi `node scripts/run-acceptance.cjs chat-ui`. Chạy acceptance model: `node scripts/run-acceptance.cjs chat-live`, cần `NINE_ROUTER_API_KEY` trong environment cha. Cả hai dùng DB riêng, không đọc/sửa DB production hoặc thay cấu hình global OpenCode.

## Phần tiếp theo

WW-4A hiển thị tiến trình task trong lúc chờ và trả nội dung khi runtime tổng kết xong. Streaming nội dung, hàng chờ gửi tiếp, context có artifact refs và retry liên kết thuộc WW-4B. Diff từng dòng/restore thuộc WW-4C; preview và phục hồi process thuộc WW-4D. Panel Thay đổi hiện vẫn dùng danh sách file của WW-3, không phải diff hoàn chỉnh. Panel chưa resize bằng kéo.

Mở bản mới bằng `npm start` sau khi đóng cửa sổ bản cũ. Không thay đổi ASF web, GitLab runner hoặc VM.
