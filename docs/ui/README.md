# Factory UI: hướng dẫn nhanh và tiến độ thiết kế lại

Thiết kế: [01-redesign-proposal.md](01-redesign-proposal.md). Bản mock: [mock/index.html](mock/index.html). Skill tham khảo: [skills/README.md](skills/README.md).

## Chạy

```powershell
cd E:\GIT\AI-SOFTWARE-FACTORY-6-AI-AGENT\apps\factory-ui     # dùng chữ E hoa: đường dẫn viết thường làm vitest lỗi
npm run check     # kiểm tra kiểu
npm test          # vitest
npm run build     # build ra dist/
npx playwright test                 # e2e với Host thật trên Windows (cần npm run build trước)
npm run e2e:work                    # e2e Host trong WSL (cần deploy Host: scripts/factory-v2/deploy-host-wsl.sh)
```

## Điều hướng (hash, không dùng thư viện router)

| Hash | Màn |
|---|---|
| `#/overview` (mặc định) | Tổng quan: ô nhập, danh sách "Cần xử lý" tối đa 5 dòng |
| `#/attention`, `#/attention/<khóa dòng>` | Cần xử lý (danh sách trái, chi tiết phải) |
| `#/team` | Đội |
| `#/project/<id>`, `/board`, `/knowledge` | Dự án: Tổng quan, Bảng việc, Tri thức (Quy trình, Tự động, Mã nguồn sẽ thêm ở U-E, U-F) |

Hash lạ rơi về `#/overview`. Tải lại trang và nút Back/Forward hoạt động.

## Token (src/styles/palette.css)

Nền tối mặc định, giữ chủ đề sáng tương đương. Biến chính: `--bg`, `--surface`, `--raised`, `--line`, `--text`, `--muted`; màu trạng thái `--need` (**chỉ cho việc cần người quyết định**), `--run`, `--ok`, `--info`; màu nhận diện dự án `--p-1…--p-4` (tông lạnh, chọn theo id dự án, không trùng màu trạng thái). Phông: `--ui` Be Vietnam Pro, `--display` Bricolage Grotesque, `--mono` JetBrains Mono; tệp nằm trong `apps/factory-ui/public/fonts` (giấy phép OFL kèm theo), nạp theo `unicode-range`, không tải từ Internet.

## Mặc định

Tiếng Việt và nền tối, trừ khi người dùng đã lưu lựa chọn (khóa `factory-ui.preferences.v1`). Bộ test e2e đặt tường minh tiếng Anh và nền sáng bằng `englishLight` trong `e2e/helpers.ts`.

## Tiến độ

| Lát | Nội dung | Trạng thái |
|---|---|---|
| U-A | Khung mới, token, điều hướng hash, Tổng quan | Xong (commit `cba3805`) |
| U-B | Cần xử lý: một danh sách, màn duyệt chia đôi, phím tắt J/K/A/R | Xong |
| U-C | Trang Dự án: 3 tab (Tổng quan, Bảng việc, Tri thức), chi tiết Task và chat agent là khung gắn bên phải | Xong |
| U-D | Đội (có chỗ cho Máy của M4) | Chưa |
| U-E | Quy trình, Tự động (lịch, rule, monitor), thông báo | Chưa |
| U-F | Tri thức, Mã nguồn (nhánh tích hợp) | Chưa |
| U-G | Cài đặt: ngân sách, mức tự chủ, Standing Approval | Chưa |

## Chưa làm trong U-A (cố ý)

- Dòng "Hoạt động" của Tổng quan: Host chưa có API đọc dòng hoạt động, nên chưa dựng dữ liệu giả.
- Ô tìm việc ở thanh trên: chưa có API tìm kiếm.
- Dạng đồ thị cho Tự động: cần thư viện xyflow, chờ duyệt.

## Lưu ý khi viết test

- Chạy từ đường dẫn **chữ E hoa**.
- Test cần tiếng Anh dùng helper trong `test/setup.ts`; e2e dùng `englishLight`.
- jsdom không áp dụng CSS: kiểm trạng thái thu gọn bằng class (`sidebar-collapsed`), không bằng `queryByText`. `fireEvent.click` không đưa focus vào nút: gọi `.focus()` trước khi kiểm tra trả focus.
