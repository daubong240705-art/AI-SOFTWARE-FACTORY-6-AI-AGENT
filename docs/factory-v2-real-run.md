# Factory V2: chạy một dự án thực tế (bản đóng gói rc1)

Tài liệu này dành cho người vận hành (một người, một máy, Host chạy trong WSL). Mọi thứ nghe ở `127.0.0.1`.
Lệnh chạy Host thật **tốn token thật**: khóa API và model do bạn tự đặt, không lưu vào đĩa.

## 1. Đóng gói và triển khai (làm một lần cho mỗi bản)

Trên Windows, tại thư mục repo:

1. Kiểm tra: `packages/factory-contracts` và `apps/factory-host` chạy `npm test`; `apps/factory-ui` chạy `npm run check` và `npm run build`.
2. Trong WSL: `bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/deploy-host-wsl.sh`
   - Chép bản build Host, contracts, gói đội (`packs/`) và giao diện sang `~/factory-v2/app` (ext4), cài phụ thuộc production.
   - Ghi file `~/factory-v2/app/VERSION` (commit, nhánh, giờ triển khai). Dòng `dirty=yes` nghĩa là thư mục làm việc còn thay đổi chưa commit.
   - Xóa sạch thư mục `app` cũ: **dừng Host trước khi triển khai**. Dữ liệu nằm ở `~/factory-v2/state`, không bị xóa.

## 2. Chuẩn bị dự án

- Bản làm việc (clone) đặt trong ext4, ví dụ `~/factory-v2/workspaces/<tên>`. Tạo bằng:
  `node ~/factory-v2/app/apps/factory-host/dist/workspace/cli.js clone --projects-root ~/factory-v2/workspaces --name <tên> --source <thư mục nguồn>`
  (chỉ lấy nội dung đã commit, không đổi nguồn). Dự án thử có sẵn: `~/factory-v2/workspaces/textstats` (mới có `SPEC.md`).
- Agent chạy trong sandbox **không có mạng**: dự án cần tải thư viện từ npm hoặc Maven sẽ kẹt. Chọn dự án chỉ dùng thư viện có sẵn, hoặc đặt sẵn cache trong bản clone.
- Không bao giờ đẩy nhánh của agent lên remote không phải của bạn. Chỉ khai báo `FACTORY_PUSH_REMOTES` cho repo của bạn.

## 3. Chạy Host thật

Trong terminal WSL:

```
export NINE_ROUTER_API_KEY=...                         # chỉ nằm trong shell này
export FACTORY_AGENT_MODELS=ds/deepseek-v4-pro         # model agent bạn chọn (cái đầu là mặc định)
export FACTORY_LEAD_MODEL=ds/deepseek-v4-pro           # model của Lead
bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/start-host-real.sh --check   # kiểm tra, không tốn token
bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/start-host-real.sh           # chạy thật
```

- `--check` xác nhận Node, bản build, bubblewrap, OpenCode, chứng chỉ gateway, khóa và model (hỏi gateway danh sách model, miễn phí).
- Ngân sách mặc định của script: 500k token mỗi việc, 2 triệu mỗi ngày. Đổi bằng `FACTORY_BUDGET_TASK_TOKENS` và `FACTORY_BUDGET_DAY_TOKENS`, hoặc trong giao diện.
- Thêm các đội nghiên cứu, kiến trúc, thiết kế: đặt `FACTORY_MULTI_TEAM=1`.
- Host in một **mã đăng nhập dùng một lần**. Mở `http://127.0.0.1:8787/`, dán mã. Khởi động lại Host thì cấp mã mới, dữ liệu vẫn còn.
- Dừng Host bằng `Ctrl+C` (Host sao lưu khi tắt).

## 4. Trên giao diện

1. **Hệ thống → Model:** xem và đổi model Lead/agent (biến môi trường chỉ là giá trị khởi tạo; khóa API và địa chỉ gateway không bao giờ hiện trên giao diện).
2. **Tạo dự án:** nút "+" ở thanh bên, loại "Dự án Git", "Chọn thư mục…" rồi chọn bản clone.
3. **Chat với Lead:** mô tả việc cần làm, duyệt kế hoạch Lead đề xuất, bắt đầu.
4. Theo dõi ở **Quy trình** (sơ đồ), **Đội** (ai đang làm gì), **Cần xử lý** (việc chờ bạn), chuông thông báo, tab **Mã nguồn** (nhánh tích hợp).
5. Duyệt kết quả từng việc: xem diff, chạy thử, chấp nhận hoặc yêu cầu sửa. Kết quả đã duyệt được gộp vào nhánh `factory/integration`.
6. Muốn lấy kết quả về máy: tải bản `.patch` rồi `git apply` trên bản Windows của repo.

## 5. Theo dõi và an toàn

- **Hệ thống:** tình trạng Host, sao lưu (mỗi giờ và khi tắt), máy chủ MCP ngoài, lệnh Host cung cấp.
- Mức tự chủ và quyền cho phép sẵn: **Cài đặt** của dự án. Mua, đẩy ra ngoài và hành động không đảo ngược luôn cần bạn duyệt.
- Token: mọi lần gọi model được đếm; vượt ngân sách thì việc bị chặn và báo cho bạn. Chi phí tiền luôn là "chưa biết" vì chưa có bảng giá.
- Sao lưu và dữ liệu: `~/factory-v2/state` (cơ sở dữ liệu, kho nội dung), bản sao lưu định kỳ trong thư mục sao lưu của Host.

## 6. Hoàn tác

- Quay lại bản build cũ: checkout commit cũ, build lại, chạy lại `deploy-host-wsl.sh`. Cơ sở dữ liệu có migration một chiều: trước khi nâng cấp, Host tự sao lưu vào `~/factory-v2/state/backups`. Muốn lùi phiên bản dữ liệu thì khôi phục từ bản sao lưu đó.

## 7. Giới hạn đã biết của bản này

- Chưa chạy end-to-end với model thật sau các thay đổi gần đây (quy trình dạng sơ đồ, giao thức cộng tác, `software-team` 1.1.0, ba đội mới). Lần chạy thật duy nhất trước đó (10/11) dùng `software-team` cũ: 5/5 việc được chấp nhận.
- Quy trình Software Delivery cho một việc mỗi bước: thao tác "Thêm việc vào bước" của Plan Patch bị Host từ chối (giao diện đã ẩn).
- Chỉ một node cục bộ (M4 chưa làm). Chỉ runtime OpenCode.
- Thông báo do Host sinh ra bằng tiếng Anh.
