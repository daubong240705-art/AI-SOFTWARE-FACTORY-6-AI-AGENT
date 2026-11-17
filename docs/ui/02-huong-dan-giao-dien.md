# Factory UI: hướng dẫn giao diện (11/2026)

Trang này thay cho 8 nguyên tắc trong [01-redesign-proposal.md](01-redesign-proposal.md) và các "hợp đồng" trong `design/factory-v2/components.json`. Đây là gợi ý để các màn trông như một sản phẩm, không phải luật. Có lý do chính đáng thì cứ làm khác, và ghi lý do trong commit.

## Sáu gợi ý

1. **Mỗi trang một tiêu đề.** Dùng `PageHeader`; nút đặt bên phải, tối đa một nút chính. Không thêm phụ đề mô tả trang.
2. **Ít khung.** Nội dung nằm thẳng trên nền, chia nhóm bằng `Section` (tiêu đề nhỏ + khoảng trắng). Chỉ dùng `Panel` hoặc `Card` khi một nhóm thật sự tách rời. Tránh thẻ lồng trong thẻ.
3. **Một cách báo trạng thái.** Dùng `StatusDot` với `toneOf(kind, state)` (`src/lib/status.ts`). Có năm tông: `need` (chờ bạn), `run` (đang chạy), `ok` (xong), `error` (lỗi hoặc kẹt, có icon cảnh báo), `idle`. Không tự chọn màu cho trạng thái.
4. **Danh sách trái, chi tiết phải.** Dùng `SplitView`. Khung phụ (`SidePanel`) mặc định đóng, mở khi người dùng bấm.
5. **Chi tiết kỹ thuật được gập.** Id, sha, đường dẫn, digest để trong `TechDetails`.
6. **Mỗi dữ kiện có một nơi chính.** Số việc chờ bạn chỉ hiện ở thanh bên, ngân sách chỉ ở Cài đặt dự án. Nơi khác chỉ đặt liên kết tới đó.

## Màu, chữ, khoảng cách

- **Màu:** lấy từ `apps/factory-ui/src/styles/palette.css` (tối mặc định, có bản sáng). Dùng tên Tailwind: `bg-background`, `bg-card`, `text-muted-foreground`, `text-need`, `bg-run`, `bg-ok`… Không viết mã hex trong component. Màu ấm `need` chỉ dùng cho "cần bạn" và lỗi.
- **Chữ:** Inter cho mọi chữ, font mono của hệ thống cho mã. Cỡ chữ:

  | Vai trò | Lớp Tailwind |
  |---|---|
  | Tiêu đề trang | `text-2xl font-semibold` (do `PageHeader` lo) |
  | Tiêu đề mục | `text-base font-semibold` |
  | Nội dung | 15px, cỡ mặc định |
  | Chữ phụ | `text-sm` hoặc `text-xs` |

  Không dùng chữ nhỏ hơn 12px.
- **Khoảng cách:**
  - Lề trang lấy từ `Page`.
  - Giữa các mục dùng `space-y-6`.
  - Trong một mục dùng `space-y-3`.
- **Chuyển động:** chỉ để phản hồi thao tác (mở khung, chuyển tab) và cho chấm "đang chạy". Luôn tôn trọng chế độ giảm chuyển động.

## Thành phần dùng chung (`src/components/app/`)

| Thành phần | Dùng khi |
|---|---|
| `PageHeader` | đầu mọi trang |
| `Section`, `Panel` | chia nhóm nội dung |
| `StatusDot` | mọi trạng thái |
| `ViewState` | đang tải, lỗi, rỗng |
| `SplitView` | màn có danh sách + chi tiết |
| `SidePanel` | khung phụ bên phải (chat, chi tiết việc, seat) |
| `TechDetails`, `KeyValueList` | thông tin phụ, cặp nhãn–giá trị |

Ngoài ra dùng `src/components/ui/*` (shadcn). Không thêm CSS viết tay mới vào `app.css`.

## Bắt buộc thật sự

Vài điều này không phải gợi ý, vì liên quan an toàn hoặc tính đúng:

- Chữ từ server hiển thị dạng chữ thường của React, không chạy HTML hay markdown từ server.
- Mọi phản hồi của Host được kiểm bằng schema của `@factory/contracts`.
- Mỗi nhãn có cả bản `vi` và `en`.
- Không hiển thị khóa API hay token.
- Đang tải không hiện số 0 như dữ liệu thật; kết quả dở dang không hiện là "Đạt".

## Kiểm tra

- `npm run check` và `npm run build` trong `apps/factory-ui`.
- `npm run check:design` trong `apps/factory-ui`: kiểm tra nhãn vi/en trong `labels.*.json` và độ tương phản của `palette.css` (nhãn trong `extra.*.ts` đã được TypeScript kiểm).
- Xem bằng mắt ở 1366×768 và 1920×1080, cả tối lẫn sáng.

Kế hoạch thiết kế lại đầy đủ (các lát RD và AG) nằm trong lịch sử commit; mỗi lát có mã `RD-x` hoặc `AG-x`.
