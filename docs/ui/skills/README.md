# Skills tham khảo cho việc làm giao diện (Factory UI)

Bộ hướng dẫn thiết kế và kỹ thuật front-end lấy từ nguồn công khai, **đã đọc và kiểm duyệt** trước khi đưa vào repo (10/11/2026).
Chúng là **tài liệu tham khảo cho agent (Codex)**, không phải mã chạy. Quy tắc của dự án luôn thắng skill nếu hai bên mâu thuẫn.

## Danh sách

| Thư mục | Nguồn | Giấy phép | Dùng cho |
|---|---|---|---|
| `anthropic-frontend-design/` | [anthropics/skills · frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 (`LICENSE.txt` trong thư mục) | Quy trình thiết kế: kế hoạch (4–6 màu có tên, vai trò chữ, bố cục + ASCII wireframe), tự duyệt, rồi mới code, rồi tự phê bình; cách viết nội dung giao diện (nút, lỗi, trạng thái rỗng); tránh dấu hiệu "giao diện do AI sinh" |
| `ecc-frontend-patterns/` | [affaan-m/everything-claude-code · frontend-patterns](https://github.com/affaan-m/everything-claude-code/tree/main/skills/frontend-patterns) | MIT, Copyright (c) 2026 Affaan Mustafa (`ecc-LICENSE.txt`) | Mẫu React: composition, compound components, custom hooks, state, hiệu năng, form, error boundary |
| `ecc-frontend-a11y/` | [.../skills/frontend-a11y](https://github.com/affaan-m/everything-claude-code/tree/main/skills/frontend-a11y) | MIT (như trên) | Khả năng truy cập trong React: nhãn form, ARIA, bàn phím, focus, reduced motion, checklist |
| `ecc-accessibility/` | [.../skills/accessibility](https://github.com/affaan-m/everything-claude-code/tree/main/skills/accessibility) | MIT (như trên) | Chuẩn WCAG 2.2 AA: kiểm tra và tiêu chí |

Tệp được tải nguyên văn từ nhánh `main` của hai kho, không sửa. SHA-256 lúc tải:

```
d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3  anthropic-frontend-design/SKILL.md
a5b971eb9e74cd763c7e3308bfd888e0d9cf69f8b88477659889d77182479740  ecc-frontend-patterns/SKILL.md
e00991a3f4d47fcf1529dd74a080afcf46137dc5061e70dc6e3da7b27f2ae3f3  ecc-frontend-a11y/SKILL.md
2762f21d09d199009ed4f95b28c911436b367c30963dc5ddb48b8e1ad7fc1585  ecc-accessibility/SKILL.md
```

## Đã kiểm duyệt gì

- Đọc toàn bộ nội dung. Không có chỉ dẫn chạy lệnh shell, cài gói, tải về, gửi dữ liệu ra ngoài, tắt kiểm tra an toàn hay "bỏ qua chỉ dẫn trước". Chỉ có các liên kết tham khảo (W3C, Apple, Android) và gợi ý thư viện `focus-trap-react` ở dạng ví dụ.
- Không dùng `ecc-design-system`: skill đó yêu cầu duyệt web qua browser MCP để "nghiên cứu đối thủ".
- Không lấy `frontend-design` của ECC: đường dẫn trả 404 (dùng bản của Anthropic).

## Giới hạn khi áp dụng cho Factory UI

- `frontend-design` viết cho trang giới thiệu và sản phẩm có "hero". Factory UI là **công cụ vận hành** (Inbox, duyệt, trạng thái hệ thống). Ưu tiên: rõ ràng, mật độ thông tin hợp lý, thao tác an toàn, ngôn ngữ nhất quán. Lấy từ skill phần quy trình, typography, viết nội dung và chất lượng tối thiểu (responsive, focus, reduced motion, tương phản); bỏ qua phần "hero" và rủi ro thẩm mỹ.
- `ecc-frontend-patterns` nhắc tới Next.js, SWR/React Query, Zustand, framer-motion, `@tanstack/react-virtual`. Factory UI dùng React 19 + Vite. **Không được thêm thư viện** chỉ vì skill nhắc; mọi dependency mới phải qua duyệt (quy ước OSS của dự án).

## Cách đưa cho Codex

Không đặt vào `.agents/skills` hay cấu hình Codex (dự án cấm sửa cấu hình Codex và không muốn tự nạp skill cho mọi card). Card giao diện ghi rõ ở phần READ FIRST:
`docs/ui/skills/anthropic-frontend-design/SKILL.md`, `docs/ui/skills/ecc-frontend-a11y/SKILL.md` (và các file khác khi cần), cộng bản thiết kế được duyệt.

Kiểm tra mã bằng `npm run check` và `npm run build`.
