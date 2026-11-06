# UX-07 — Sơ đồ Mermaid

Ngày: 2026-11-05. Tiếp nối ảnh đính kèm `cb8ab4d`; checkpoint `checkpoint/ux07-mermaid-start-20261105`. Giữ Worker `1.3.0-alpha.8`, SQLite 13, Controller/runtime/quyền hiện tại.

## Đã triển khai

- Khối Markdown `mermaid` hiển thị mã gốc với `Xem sơ đồ`, `Xem mã`, `Sao chép`. Bấm ảnh để phóng to trong dialog; có cuộn nội bộ cho sơ đồ rộng, dùng bàn phím/Escape. Chat, mô tả công việc và báo cáo dùng chung ChatMarkdown.
- Đóng gói `@mermaid-js/tiny@12.3.0`, MIT: một package mới, không dependency ngoài kéo theo. Browser script khoảng 2,85 MB được ghim version/integrity và nạp từ asset local khi người dùng bấm xem. Không CDN, không eval hay script tải từ repo ngoài; không bundle lại toàn bộ Mermaid vào lần tải chat đầu tiên.
- Chỉ nhận flowchart/graph, sequence, class, state-v2 và ER diagram. Chặn trước directive/frontmatter, HTML/Markdown labels, URL/file/data/javascript, CSS tự do, callback/link/icon/image và loại diagram ngoài danh sách.
- Mermaid chạy `securityLevel: strict`, `htmlLabels: false`. Output SVG được parse lại bằng DOMParser và dựng cây tag/attribute allowlist; bỏ script/foreignObject/image/link/event/inline style và marker/clip reference thiếu. CSS nhúng chỉ từ ứng dụng, không dùng CSS do model/library trả về. Kết quả hiển thị như ảnh Blob, không chèn SVG raw vào phần giao diện React. Renderer Mermaid có container tạm ngoài màn hình để đo layout, được xóa cả khi lỗi.
- Giới hạn 8.000 ký tự, 120 dòng, 180 câu lệnh, 80 kết nối; output tối đa 600 KB, 6.000 element, sâu 40 lớp, cạnh 8192 px và 16 megapixel. Một hàng đợi render tuần tự, tối đa bốn yêu cầu; cache RAM tối đa 12 sơ đồ/2 MB, thu hồi Blob URL khi đổi hội thoại hoặc lỗi ảnh.
- Lỗi/cú pháp chưa hoàn chỉnh giữ mã gốc, không dựng trong lúc streaming và không tự retry. CSP chỉ thêm `blob:` vào `img-src`; script policy tiếp tục self-only, không thêm quyền mạng/filesystem/IPC. Không lưu SVG hoặc cache vào SQLite và không migration.

## Kiểm chứng

- Ba test thuần về loại diagram, giới hạn và nội dung không được hỗ trợ.
- Electron production thật: năm loại sơ đồ dựng được và giữ nhãn; ba trường hợp HTML/directive/cú pháp lỗi giữ mã gốc; sanitizer nhận output độc hại và loại script/foreignObject/image/link/event/URL/style/reference thiếu. Kiểm tra cả DTD/entity, kích thước, số element/bytes và độ sâu.
- Layout/preview ở 1366×768, 850×700, zoom 125% và 150%; không lỗi renderer hoặc request HTTP/HTTPS. Đã xem ảnh cửa sổ nhỏ và phóng to; chỉnh căn giữa nhãn node sau kiểm tra.
- Script `node scripts/run-acceptance.cjs mermaid-ui` dùng app data riêng trong `.cache`; không model thật, không credentials/data người dùng. Screenshot/SVG fixture/log không commit.

Lệnh kiểm tra: `npm run typecheck`, `npm run format:check`, `npm test`, `npm run test:native`, `npm run build`; sau build chạy `mermaid-ui`, `images-ui`, `chat-host-ui` qua `scripts/run-acceptance.cjs`.

Kết quả chốt: **216/216 test đạt**, typecheck/format/native SQLite/build đạt. Ba lượt Electron `mermaid-ui`, `images-ui`, `chat-host-ui` đều ghi `passed: true`, không lỗi renderer; Mermaid và ảnh không phát sinh request ngoài. Log bộ test/build và kết quả acceptance nằm trong `.cache/ux07-mermaid-final-tests.log`, `.cache/ux07-mermaid-build.log`, `.cache/mermaid-ui-ZRNsh7/acceptance.json`, `.cache/images-ui-MCbaY7/acceptance.json`, `.cache/chat-host-ui-YZlHgV/acceptance.json` dưới `apps/windows-worker` (local, đã ignore).

## Giới hạn

Đây là renderer cục bộ, không kiểm chứng ngữ nghĩa hoặc nội dung model. Subset cố ý không hỗ trợ Mermaid tùy biến đầy đủ, HTML, link, icon, math, mindmap hoặc architecture; mã không hỗ trợ vẫn xem/sao chép được. Không có hard CPU isolation cho layout đồng bộ trong renderer; input/output caps và render theo yêu cầu giới hạn phạm vi. Cache RAM mất khi đóng app; xuất báo cáo giữ Markdown nguồn hiện có. Remote PR/issues, UX-08 lịch/quy tắc, 3D và WW-5 chưa triển khai trong đợt này.

`npm audit` ghi nhận một advisory mức low có sẵn trong `tsx → esbuild@0.27.7` (dev server Windows), không phát sinh từ Mermaid Tiny. Không tự cập nhật dependency ngoài phạm vi.

## File chính

`shared/diagrams.ts`, `src/lib/diagram-renderer.ts`, `diagram-svg.ts`, `src/features/MermaidBlock.tsx`, `ChatMarkdown.tsx`, `diagrams.css`, CSP, package/lock, `tests/diagrams.test.ts`, `scripts/acceptance-mermaid-ui.cjs`, runner và thông báo giấy phép.
