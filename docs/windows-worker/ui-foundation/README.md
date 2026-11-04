# Bộ nền giao diện Windows Worker

Áp dụng trong `1.3.0-alpha.4`, sau V1.3C. Mục tiêu: chữ đọc rõ, khoảng cách nhất quán, thẻ giữ chiều cao theo nội dung, dữ liệu dài cuộn trong vùng riêng. Đây là nền giao diện cho Windows Worker; chưa triển khai phòng agent 3D của giai đoạn tiếp theo.

## 1. Cấu trúc và quyền sở hữu CSS

| File | Trách nhiệm |
| --- | --- |
| `apps/windows-worker/src/ui/tokens.css` | Font, cỡ chữ, khoảng cách, kích thước control, màu và giới hạn khung |
| `apps/windows-worker/src/ui/primitives.tsx` | Stack, Cluster, Notice, ScrollRegion; chỉ bố cục, không giữ trạng thái nghiệp vụ |
| `apps/windows-worker/src/ui/base.css` | Quy tắc bố cục chung và các hợp đồng bố cục cho màn hình hiện có; chia 10 nhóm có chú thích |
| `src/styles.css`, `chat.css`, `monitor.css`, `kanban.css`, `inspector.css` | Giao diện và trạng thái riêng của từng tính năng |
| `src/main.tsx` | Thứ tự import CSS duy nhất: tokens → styles → chat → monitor → kanban → inspector → base |

CSS cũ chưa được viết lại toàn bộ. Base được nạp cuối để thống nhất các quy tắc bố cục đang xung đột. Khi thêm tính năng, dùng token và primitive trước; chỉ thêm quy tắc riêng khi có nhu cầu thực tế. Không thêm framework/dependency để làm layout.

Không đặt selector toàn cục `nav`, `header`, `section` cho một màn hình. Ví dụ sidebar dùng `.sidebar nav`, không ảnh hưởng tab/timeline trong nội dung. Không import CSS từ component được render bằng Node trong test; tập trung import ở entry renderer.

## 2. Typography

| Mục đích | Token | Giá trị |
| --- | --- | --- |
| Nội dung | `--font-body`, `--text-body` | Segoe UI/system-ui, 14px |
| Control | `--text-control` | 13px |
| Metadata | `--text-sm` | 12px |
| Badge/thông tin phụ ngắn | `--text-xs` | 11px |
| Tiêu đề trang | `--text-title` | 24px, line-height 1.3 |
| Nội dung nhiều dòng | `--leading-body` | 1.55 |
| Nhãn/control | `--leading-label` | 1.4 |
| Source/lệnh | `--font-code` | Consolas/Cascadia Code/monospace |

Không dùng cỡ metadata cho nội dung chính. Căn trái/đầu dòng cho văn bản; căn trên cho ô bảng và hàng facts. Dùng chữ số tabular cho thời gian. Không thêm mô tả dài vào tiêu đề hoặc toolbar. Trạng thái luôn có chữ, không chỉ dùng màu.

## 3. Khoảng cách và kích thước

Thang khoảng cách: `--space-1/2/3/4/5/6/8` = **4/8/12/16/20/24/32px**.

- Icon với nhãn hoặc control liên quan: 8px.
- Các dòng trong một nhóm/thẻ: 12px.
- Các phần trong inspector: 16px.
- Padding trang: 24px; cửa sổ ≤1100 CSS px: 20px.
- Control thông thường: tối thiểu 36px; nút phụ nhỏ: 30px.
- Checkbox/radio: 16×16px, margin/padding 0, không kế thừa width 100% của input.
- Sidebar mở rộng: `--sidebar-width` 240px; nội dung trang tối đa 1560px; inspector tối đa 920px và chừa mép cửa sổ 16px.
- Bo góc control 7px, panel 12px. Không đổi màu theo từng trang; lấy từ token semantic trong `tokens.css`.

Dùng `gap` cho khoảng cách giữa các phần tử cùng nhóm. Tránh cộng chồng margin con với gap cha. Bỏ margin mặc định của con trong Stack; nhãn input dùng khoảng cách 8px. Trường số có đơn vị tùy chọn vẫn phải thẳng hàng với trường bên cạnh.

## 4. Primitive dùng lại

```tsx
import { Stack, Cluster, Notice, ScrollRegion } from "./ui/primitives";

<Stack>
  <h3>Kết quả</h3>
  <p>{summary}</p>
  <Cluster>
    <button onClick={openDetails}>Chi tiết</button>
    <button onClick={openChanges}>Thay đổi</button>
  </Cluster>
</Stack>

<Notice tone="error" actions={<button onClick={retry}>Thử lại</button>}>
  <p>{error}</p>
  <p>{nextStep}</p>
</Notice>

<ScrollRegion label="Bảng kết quả">
  <table>{/* thead và tbody semantic */}</table>
</ScrollRegion>
```

Đường import điều chỉnh theo vị trí file. Stack là cột có gap 12px; Cluster là hàng có gap 8px và tự xuống dòng. Notice tách phần nội dung và nhóm thao tác, tránh các đoạn văn/nút dính thành một hàng. Notice lỗi có `role=alert`, loại khác `role=status`; không dùng nó cho nội dung cập nhật liên tục. ScrollRegion có nhãn và nhận focus bàn phím; **phải đặt giới hạn chiều cao theo tính năng** nếu nội dung có thể rất dài.

Các class có thể áp dụng trực tiếp: `.ui-stack`, `.ui-cluster`, `.ui-wrap`, `.ui-truncate`. Không bọc thêm div nếu phần tử semantic hiện có đã phù hợp.

## 5. Nội dung dài và chống tràn

| Nội dung | Quy tắc |
| --- | --- |
| Tiêu đề task, lỗi, đường dẫn evidence | Xuống dòng, `overflow-wrap:anywhere`, căn đầu dòng |
| Nhãn trạng thái/role/thời gian | Giữ liền; không co badge; nhóm cha có thể wrap |
| Tiêu đề hội thoại trong sidebar/header | Có thể ellipsis; nội dung đầy đủ vẫn nằm trong hội thoại |
| Toolbar | Wrap cả control; không cắt nhãn nút hành động |
| Source/lệnh có định dạng | Giữ dòng gốc, cuộn ngang trong khối code |
| Bảng markdown | ScrollRegion hai chiều; không làm rộng trang |
| Facts trong inspector | Nhãn và giá trị cùng hàng, căn trên; giá trị dài xuống dòng |

Flex/grid con chứa văn bản phải có `min-width:0`; grid dùng `minmax(0,1fr)`. Không dùng `overflow:hidden` toàn trang để che lỗi tràn. Không ép chiều cao bằng nhau cho các thẻ có lượng nội dung khác nhau.

## 6. Kanban và agent

- Hàng Kanban căn đầu: `align-items:flex-start`. Mỗi cột cao theo nội dung, tối thiểu 170px, tối đa `clamp(260px,55vh,640px)`.
- Mỗi cột rộng `clamp(245px,18vw,285px)`. Board cuộn ngang khi thiếu chỗ; cột cuộn dọc khi nhiều thẻ. Header cột sticky và có nền để không đè chữ thẻ.
- Không stretch cột ít việc theo cột backlog. Không giảm cỡ chữ để nhét đủ tất cả cột vào một cửa sổ.
- Tiêu đề thẻ xuống dòng; role/badge không bị bóp méo. Thao tác thẻ tối thiểu 30px.
- Bộ lọc checkbox căn giữa với nhãn. Phân trang và roster có thể wrap.
- Agent grid dùng chiều rộng thẻ tối thiểu 265px hoặc toàn bộ chiều rộng khả dụng; căn trên. Model dài xuống dòng, nút task không nowrap.

## 7. Chat, bảng, dialog và cài đặt

- Bảng markdown tối đa 360px cao; header sticky, ô căn đầu/trên, padding 8×12px, chiều rộng ô 100–320px. Bảng rộng giữ thanh cuộn riêng; đây là chủ ý để đọc đủ cột.
- Code block tối đa 400px cao, cuộn riêng; không bẻ dòng source làm sai cách đọc.
- Các tab panel chat wrap trong phần chiều rộng còn lại; nút đóng không co và không bị tab che.
- Dialog giới hạn cao theo `100dvh - 32px`, có cuộn nội bộ; không vượt cửa sổ. Giữ cơ chế đóng/focus hiện có.
- Settings: cột chính linh hoạt và cột đội agent 300–360px; ≤1100px chuyển một cột. Form ba cột của board editor chuyển một cột khi ≤900px.
- Cửa sổ có thể cuộn dọc khi nội dung không đủ chỗ. Chỉ board, bảng và source được cuộn ngang; không tạo thanh cuộn ngang cho toàn trang.
- Focus bàn phím có outline rõ. Tôn trọng `prefers-reduced-motion`. Chưa tuyên bố kiểm định accessibility toàn diện hoặc hỗ trợ mobile.

## 8. Những lỗi đã xử lý

| Vấn đề | Cách sửa | Kiểm chứng |
| --- | --- | --- |
| Cột board kéo dài theo cột nhiều việc | Căn trên, giới hạn từng cột, cuộn riêng | Đo chiều cao cột và cuộn tới thẻ/cột cuối |
| Nút task không xuống dòng | Wrap tiêu đề/đường dẫn theo phạm vi | Fixture tiêu đề dài, đo overflow |
| Checkbox lệch/nhận kích thước input thường | Reset checkbox/radio 16px và margin | So tâm checkbox với nhãn |
| Nội dung recovery/command sát nhau | Notice tách nội dung/thao tác; padding/gap cho command card | Rà source và ảnh inspector |
| Nhãn/ô nhập số không đều | Bố cục label thống nhất kể cả có đơn vị | Đo top các input settings |
| Bảng chat quá cao/rộng | ScrollRegion có chiều cao tối đa | Fixture 24 hàng/6 cột và đường dẫn dài |
| Tab panel đè nút đóng | Tab wrap, nút đóng không co | Đo khung các con header ở 5 cấu hình |
| CSS sidebar ảnh hưởng vùng khác | Scope `.sidebar nav`, thứ tự import tập trung | Typecheck, SSR tests và kiểm tra renderer |

## 9. Chạy kiểm tra và bằng chứng

Từ `apps/windows-worker`:

```powershell
npm run typecheck
npm test
npm run format:check
npm run test:native
npm run build
node scripts/run-acceptance.cjs ui-foundation
```

Lệnh cuối mở production Electron ở chế độ ẩn, tạo SQLite riêng trong `.cache/ui-foundation-*`, không dùng credential/database người dùng, không gọi model. Bằng chứng được tạo lại trong thư mục tài liệu này; chạy audit sẽ cập nhật ảnh và JSON tại đây. Launcher bỏ `ELECTRON_RUN_AS_NODE` tự động.

Audit dùng 1920×1080, 1440×960, 1100×800, 850×700 ở zoom 100%, và 1100×800 ở zoom 125%. Viewport đo thực tế nằm trong [layout-checks.json](layout-checks.json); ảnh PNG có thể lớn hơn kích thước cửa sổ do DPI Windows. Dữ liệu có tiêu đề/model/đường dẫn dài, code 500 ký tự một dòng, 15 thẻ backlog, cột ít việc và rỗng.

Ảnh: [Kanban](kanban-desktop.png), [cửa sổ nhỏ](kanban-small.png), [chat và panel](chat-panel-desktop.png), [inspector](inspector-desktop.png), [agent](agents-desktop.png), [settings](settings-desktop.png), [settings cửa sổ nhỏ](settings-small.png).

Audit đo overflow, căn hàng, giới hạn chiều cao, cuộn tới cuối và lỗi renderer. Đây là kiểm tra bố cục với fixture, không phải bằng chứng model/runtime thật, không bao phủ mọi trạng thái lỗi/permission/preview/diff. Các test hiện có kiểm tra hành vi; khi thay màn hình đó cần kiểm tra trực quan bổ sung đúng trạng thái liên quan.

## 10. Điều kiện hoàn thành một thay đổi UI

1. Dùng token, xác định component sở hữu layout, tránh selector toàn cục mới.
2. Thử nội dung rỗng, ngắn, nhiều dòng và chuỗi dài không có dấu cách.
3. Kiểm tra 1440px, 850px và zoom 125%; không tràn trang hoặc che thao tác.
4. Cột/thẻ chiều cao tự nhiên; vùng bảng/source có giới hạn và đọc được mục cuối.
5. Nhãn form, badge, button và checkbox căn đều; không dựa vào số dấu cách trong text.
6. Kiểm tra focus bàn phím, nút đóng, nhãn vùng cuộn và trạng thái disabled.
7. Chạy format/typecheck/build và test liên quan. Cập nhật audit khi hợp đồng bố cục thay đổi; không nới assertion chỉ để qua.
8. Xem ảnh sau khi chạy; phép đo DOM không thay thế kiểm tra trực quan.
