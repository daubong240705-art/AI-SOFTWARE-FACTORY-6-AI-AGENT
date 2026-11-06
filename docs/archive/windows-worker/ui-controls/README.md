# Card, Board và dropdown — 1.3.0-alpha.5

Ngày 05/11/2026, nối tiếp bộ nền UI alpha.4. Checkpoint: `checkpoint/ui-controls-start-20261105` tại `663d8bf`.

## Thay đổi theo yêu cầu

- **Đội ngũ:** tất cả card có chiều cao bằng nhau giữa các hàng. Tiêu đề, trạng thái và model vẫn căn trên; nội dung nhiều dòng được giữ đầy đủ.
- **Board:** các cột cao bằng nhau và lấp đầy phần màn hình còn lại bên dưới heading/filter/phân trang, phía trên statusbar. Khi resize, zoom hoặc bộ lọc xuống dòng, vùng cột tự tính lại bằng flex. Nội dung mỗi cột cuộn dọc, toàn Board cuộn ngang; không đẩy thanh cuộn xuống ngoài màn hình.
- **Dropdown:** thay toàn bộ select đang hiển thị trong Worker bằng component riêng; không còn menu native. Mũi tên SVG căn giữa, menu cùng theme, giá trị chọn có dấu check; item dài xuống dòng. Áp dụng cho Board/editor, chat/model/quyền, cài đặt/preset, task inspector/timeline, activity, diff và lệnh dự án.
- Menu dùng HTML/CSS trong top layer của Electron, tự mở lên trên khi sát đáy và vẫn hoạt động bên trong dialog. Không thêm dependency.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck, format, production build | Đạt |
| Regression suite | 152/152 |
| Layout/interaction audit | 5/5 cấu hình cửa sổ/zoom; không lỗi renderer |
| Inspector UI | Đạt: chọn attempt, evidence/diff, điều hướng và giữ draft |
| Evidence UI | Đạt: chuyển run/staged/unstaged, restore và command output |
| Workspace UI | Đạt: chọn chế độ, lưu cấu hình, tạo/mở/xóa workspace theo quy tắc hiện có |

[Phép đo bố cục](layout-checks.json) gồm chiều cao card/cột, đáy Board, overflow, cuộn đến mục cuối, tâm mũi tên và menu trong viewport. Audit tương tác kiểm tra chọn bằng click và keyboard handler, End/Enter, Escape, Tab, bấm ngoài, mở lên trên ở composer và chọn role trong modal. Các sự kiện bàn phím của audit được dispatch vào handler thật do cửa sổ Electron ẩn không nhận OS keyboard focus.

Không gọi model hoặc dùng database/credential người dùng. Không thay main/preload, schema, Controller hay runtime. Kiểm định screen reader toàn diện chưa thực hiện.

## Ảnh

- Đội ngũ (`agents-desktop.png`, ảnh local)
- Board (`kanban-desktop.png`, ảnh local) · cửa sổ nhỏ (`kanban-small.png`, ảnh local)
- Menu dropdown (`dropdown-desktop.png`, ảnh local)
- Chat (`chat-panel-desktop.png`, ảnh local) · Inspector (`inspector-desktop.png`, ảnh local)
- Cài đặt (`settings-desktop.png`, ảnh local) · cửa sổ nhỏ (`settings-small.png`, ảnh local)

Các thư mục `inspector/` và `evidence/` chứa kết quả regression bổ sung, tách khỏi bằng chứng các phiên bản trước.

[Quy chuẩn UI và API Select](../ui-foundation/README.md). Đóng cửa sổ Worker cũ rồi chạy `npm start` từ `apps/windows-worker` để nạp bản mới.
