# Factory V2 — Design baseline F0-02

Bộ chuẩn triển khai theo [UI/UX 06/11](../../plan/factory-v2/uiux-upgrade.md): Light/Dark/System, Inter, Việt–Anh và chat dạng cửa sổ. **Đây là fixture thiết kế offline, chưa nối Host/model/DB hoặc ứng dụng V1.**

## Mở bản mẫu

Từ repo root, Node 22:

```sh
node scripts/factory-v2/build-style-guide.mjs
```

Mở `.cache/factory-v2/style-guide/index.html` bằng trình duyệt. Một file HTML tự chứa font/CSS/data/script, không cần server, npm install hoặc mạng. Settings ở header/footer đổi theme/ngôn ngữ; Bộ chuẩn cho mở chat từng agent. Board, Tổng quan, Đội ngũ, Cần bạn xử lý, Settings và Bộ chuẩn là các view mẫu; các tab khác mở checklist thay vì giả chức năng thật.

Thử kéo header chat; resize bằng góc dưới phải; khi focus nút Move/Resize dùng Arrow (8 px), Shift+Arrow (1 px). Thu nhỏ về khay, mở lớn/khôi phục, đóng rồi mở lại từ Team. Các thao tác chỉ đổi state mẫu, không chạy agent. Màn hẹp hiện một chat active; dùng khay chuyển cửa sổ. Đóng không xóa nháp trong phiên; **reload làm mất nháp/tin nhắn mẫu**. Chỉ theme/locale/bounds/mode được lưu localStorage có version. Browser chặn storage thì fallback bộ nhớ.

Một cửa sổ mẫu cho mỗi agent, tối đa sáu agent trong fixture hiện tại; giới hạn geometry registry là 10. Đây không phải chứng cứ đã có registry conversation tùy ý, runtime song song hoặc workload 10 cửa sổ production. Không tự dịch tên/task/tin nhắn/đặc tả thiết kế khi đổi ngôn ngữ; chỉ chrome UI đổi.

## Source và ranh giới

| File | Vai trò |
|---|---|
| `tokens.json` | Semantic colors hai theme, typography/layout/motion/layers, các cặp contrast và provenance |
| `labels.vi.json`, `labels.en.json` | Nhãn UI, trạng thái, tooltip hints, Settings; key/placeholder parity |
| `components.json` | 22 component contracts, 7 view states, window modes và trách nhiệm production |
| `screens.json` | 9 reference mappings + shared/per-screen checks, ưu tiên Board/Dashboard/Team; visual target cũ chỉ lịch sử |
| `seed.json` | 2 project, 6 agent, 7 task, BA data/API v1, FE/BE độc lập, QA chờ, một business decision; 8 scenarios |
| `window-state.mjs` | Geometry/persistence thuần để minh họa clamp/min/max/restore; không quản lý conversation hoặc dispatch |
| `preview.mjs`, `style-guide.css` | DOM fixture, Pointer Events mẫu, nhãn từ resources; chưa phải React UI hoặc design-system package production |
| `assets/` | Inter WOFF2, OFL notice và manifest revision/hash nguồn chính thức |

Ảnh CrewHub nằm local trong `crewhub/`, không bundle hoặc stage. Screens.json bám ID/hash trong manifest nghiên cứu; checkout thiếu ảnh vẫn build fixture, verifier báo thiếu ảnh thay vì giả đã kiểm. Light palette là đề xuất ASF; không có baseline Light local đã xác minh để công bố tương đồng 90%.

Inter normal variable font được pin kèm OFL; cmap đã kiểm chữ Việt NFC/NFD và Latin Extended Additional. Chưa kiểm glyph rendering trên browser, chưa bundle italic. Inline SVG đơn giản trong fixture được tự viết; production F2 dùng Lucide và accessible primitives theo kế hoạch, không import các SVG này như bộ icon đã hoàn thiện.

## Xác thực

```sh
node scripts/factory-v2/build-style-guide.mjs
python scripts/factory-v2/verify-font.py
node scripts/factory-v2/verify-design.mjs
```

Font checker dùng fontTools đã có; nếu Python thiếu Brotli thì đọc font bằng decoder built-in Node qua stdin, không cài package. Nếu máy chưa có fontTools thì báo thiếu công cụ; builder vẫn chạy độc lập, không tự tải/install.

Verifier kiểm JSON/resources/tokens/contrast, references/dependency DAG, font hashes/cmap, syntax và syntax. Report: [F0-02 validation](../../research/factory-v2/f0-02-validation.json).

Native `details` menu và browser title hints là giới hạn prototype; menu portal/collision/full keyboard, custom tooltip, Markdown renderer/code highlighting, production window manager, durable drafts và shared Host stream thuộc F0-03/F2/F3. Chưa có browser QA mới vì lượt Computer Use trước đã dừng theo URL-confidence guard. Không gọi HTML này là Alpha làm việc thật.
