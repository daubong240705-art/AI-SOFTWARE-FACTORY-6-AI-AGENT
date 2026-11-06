# WW-4B — Streaming, hàng chờ và thử lại

Ngày 04/11/2026. Nhánh `feature/windows-worker-ww4b`.

Chat nhận dần nội dung trả lời qua SSE OpenCode. Chỉ text của message được xác định là assistant được chuyển sang chat; không đưa prompt người dùng, reasoning hoặc JSON lập kế hoạch/review vào transcript. Với đội agent, stream nội dung task work/fix kèm nhãn vai trò; cuối lượt thay bằng báo cáo tổng kết. Text được redaction và giới hạn độ dài, ghi SQLite tối đa khoảng mỗi 150 ms; giao diện đọc cập nhật mỗi 400 ms. Giữ một phần đuôi trong lúc stream để tránh lộ credential bị chia giữa các chunk; câu trả lời ngắn có thể chỉ xuất hiện khi kết thúc. Nội dung đã lưu vẫn đọc được khi hủy/gián đoạn và có trạng thái tương ứng.

Trong lúc chạy, Enter hoặc nút gửi thêm yêu cầu vào hàng chờ; nút Dừng vẫn riêng biệt. Có sửa/xóa yêu cầu chưa chạy. Tối đa 50 yêu cầu toàn ứng dụng. Mỗi yêu cầu giữ project, hội thoại, chế độ, vai trò và snapshot cấu hình lúc gửi. Hàng chờ hiện model trong tooltip vai trò. Sau thành công, chỉ chuyển sang yêu cầu tiếp khi runtime/proxy đã đóng, snapshot kết quả đã lưu và khóa lượt cũ đã được nhả. Lượt mới kiểm tra lại source và tạo baseline/budget/session/context riêng.

Lỗi, hủy, cần bổ sung, đóng hoặc mở lại app giữ yêu cầu để người dùng chọn **Chạy tiếp** từ đầu hàng chờ. Yêu cầu mới không vượt qua yêu cầu đang giữ trong cùng hội thoại. Cấu hình thay đổi thì không âm thầm đổi model: giữ yêu cầu và báo cần xóa/gửi lại với cấu hình mới. Hàng chờ và tạo run được chuyển trong cùng transaction, không tự thực thi lại khi mở app.

Nút **Thử lại · lượt mới** tạo run mới từ yêu cầu cũ và cấu hình hiện tại, có `retryOf`/`attemptRoot`; lịch sử cũ không bị sửa. **Lượt gốc** mở bằng chứng lần trước. Context lấy tối đa bốn lượt, có tóm tắt và tham chiếu file, command ID/exit code và AC/task; không gửi toàn bộ output lệnh và không replay lệnh cũ.

Schema5 thêm `follow_ups`; trước nâng schema4 lưu `worker.schema4.backup.sqlite`. Giữ conversation/message/run/ciphertext/bản nháp. Phục hồi run đang hoạt động dùng truy vấn trực tiếp mọi run active, không phụ thuộc giới hạn 50 run lịch sử.

## Bằng chứng

- [Model thật](ww4b/live-chat.json): DeepSeek **`ds/deepseek-v4-flash`** qua 9Router, một lượt trả lời, một follow-up tự chạy sau đó và một lần thử lại lượt đã hủy. Ba lượt model thành công, mỗi lượt một request; lượt hủy trước startup dùng 0 request. Follow-up nhắc lại đúng marker từ lượt đầu, tham chiếu đúng context; thời điểm bắt đầu sau thời điểm kết thúc lượt trước. Quan sát được partial text trong trạng thái running. Không shell hoặc thay đổi source.
- [UI acceptance](ww4b/ui-acceptance.json): bản Electron đã build, main/preload/renderer và SQLite/IPC thật trong dữ liệu tạm. Sửa/xóa hàng chờ, Enter thêm yêu cầu đang giữ, bảo toàn draft khi polling, hiển thị partial interrupted và nút retry. Không tràn ngang ở 850×700; composer vẫn hiện.
- Ảnh chat và hàng chờ (`ww4b/chat-queue.png`, ảnh local), cửa sổ nhỏ (`ww4b/chat-small.png`, ảnh local). Nội dung ảnh là fixture UI, không phải lượt trả lời model mới.
- `npm run typecheck`, `npm test` (**32/32**), `npm run test:native`, `npm run build`, `npm run format:check`.
- Test bao gồm migration schema4, giữ thứ tự và rollback claim, khóa một run, hủy/khôi phục hàng chờ, thay cấu hình/project, retry/history và lọc text/delta/reasoning/prompt.

Chạy lại: `node scripts/run-acceptance.cjs follow-ups` cần `NINE_ROUTER_API_KEY` trong môi trường cha và có gọi model thật. `npm run build` rồi `node scripts/run-acceptance.cjs follow-ups-ui` dùng fixture, không gọi provider. Cả hai dùng DB tạm, không sửa cấu hình OpenCode global.

WW-4C tiếp tục diff theo dòng, snapshot lịch sử và restore từng file. WW-4D dành cho preview, quản lý process khi crash/đóng cửa sổ và retention/export. Chưa có bộ cài; đóng app cũ rồi chạy `npm start` để dùng phiên bản mới.
