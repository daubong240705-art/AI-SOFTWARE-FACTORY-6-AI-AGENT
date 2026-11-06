# UX-07 — Ảnh đính kèm trong chat

Ngày: 2026-11-05. Tiếp nối Git local `cbb74b2`; checkpoint `checkpoint/ux07-images-start-20261105`. Giữ Factory Lite + Windows Worker, Controller hiện tại và version `1.3.0-alpha.8`. SQLite **13**, không thêm dependency.

## Đã triển khai

- Composer có nút chọn ảnh, nhận ảnh PNG/JPEG từ clipboard, thumbnail, bỏ từng ảnh và hộp xem ảnh lớn. Fullscreen/dock dùng cùng ChatHost; ảnh nháp nằm theo project và hội thoại, khôi phục khi mở lại.
- Message và hàng chờ hiển thị ảnh đã lưu. ChatSend fingerprint bao gồm ID ảnh; validation/dispatch/chuyển nháp sang đã gửi nằm trong cùng transaction. Hàng chờ, retry và recovery giữ ID ảnh bất biến. Mất phản hồi sau commit rồi tải lại vẫn khôi phục ảnh từ queue/message để gửi lại cùng request, không tạo tin trùng.
- OpenCode nhận file parts dạng data URL ở lượt direct hoặc bước lập kế hoạch của Lead. Cấu hình runtime bật attachment/image modality cho yêu cầu có ảnh; gateway/model phải thực sự hỗ trợ. Không tự đổi model. Các worker downstream nhận mô tả/handoff của Lead; không tự gửi lại ảnh cho mọi agent hoặc mọi lượt lịch sử. Context cũ ghi rõ ảnh không được đính kèm lại.
- Main process kiểm tra chữ ký PNG/JPEG, dung lượng và dimensions trước native decode; sau đó mã hóa lại thành PNG để bỏ metadata/trailing payload. Renderer không truyền đường dẫn filesystem hoặc tự chọn MIME cho giao thức phục vụ ảnh.
- Giao thức `asf-image://asset/<project>/<conversation>/<image>` chỉ nhận GET và UUID đúng phạm vi; kiểm tra SHA-256/dung lượng trước khi đọc. Chặn query, userinfo, traversal và URL bên ngoài. CSP chỉ thêm scheme ảnh nội bộ; Markdown tiếp tục vô hiệu hóa HTML/ảnh bên ngoài/SVG.
- Export run kèm metadata nguồn người dùng, SHA-256, kích thước, thời điểm và base64 của ảnh đã chuẩn hóa. Byte base64 được thêm sau text redaction để không làm hỏng ảnh. Data URL ảnh bị lược khỏi log/lỗi; ảnh người dùng vẫn có thể chứa nội dung nhạy cảm nhìn thấy bằng mắt.
- Bỏ ảnh nháp, xóa queue và prune lịch sử thu gom ảnh không còn được run/queue/nháp tham chiếu. Nháp không tự hết hạn; gỡ project giữ lịch sử/ảnh như cơ chế hội thoại hiện tại. Xóa row giúp SQLite tái sử dụng trang; không tự VACUUM hoặc xóa backup/runtime cache OpenCode.

## Giới hạn và dữ liệu

Tối đa 4 ảnh/tin; input 5 MB/ảnh, cạnh tối đa 4096 px và 12 megapixel. PNG sau chuẩn hóa tối đa 1 MB/ảnh, giữ tổng payload base64 của 4 ảnh dưới giới hạn proxy 8 MB cùng phần text thông thường. Kho ảnh tối đa 100 MB/project, 500 MB toàn app; ảnh lớn hoặc kho đầy báo lỗi rõ ràng. Cần nội dung text khi gửi. Không hỗ trợ SVG, GIF, WebP, PDF hoặc drag/drop trong đợt này.

Thêm bảng `chat_images` chứa metadata, BLOB chuẩn hóa và trạng thái draft. Run/queue giữ `imageIds` trong JSON hiện có. Nâng từ schema 12 tạo `worker.schema12.pre-images.backup.sqlite` trước migration; bản app cũ không đọc schema 13. Không sửa source dự án hoặc credentials trong migration. Fixture downgrade schema 2–11 được cập nhật để loại bảng mới trước khi mô phỏng dữ liệu cũ.

## Kiểm chứng

- Typecheck, format, production build và native SQLite/safeStorage đạt. Build còn cảnh báo PURE annotation có sẵn từ Zod.
- **213/213 test toàn dự án đạt**, trong đó 7 ca image kiểm tra phạm vi project/hội thoại, chữ ký/dimensions/size, protocol/traversal/corruption, drafts/reopen, transaction rollback/idempotency, queue/retry, export base64, retention, migration và SDK prompt parts. Log cuối: `.cache/ux07-images-final-tests.log`.
- Electron thật qua main/preload/renderer/native decoder/SQLite: chọn file, dán JPEG, chuẩn hóa PNG, loại trailing payload, từ chối SVG, đọc protocol, xem ảnh, draft reload, lost-receipt reload/dedup, queue ảnh và không có HTTP/HTTPS request ngoài. 4 cấu hình: 1366×768, 850×700, zoom 125% và 150%; không lỗi renderer/tràn ngang/composer bị che. Đã xem ảnh chụp cửa sổ nhỏ và preview 150%.
- Regression ChatHost dock/fullscreen/IME/draft/idempotency cũng đạt 4 cấu hình. Các fixture dùng dữ liệu riêng; ảnh chụp/log/SQLite chỉ trong `.cache`, không commit.

Kết quả Electron cuối: `.cache/images-ui-cBSSIh/acceptance.json`, `.cache/chat-host-ui-Q43BXT/acceptance.json`; build `.cache/ux07-images-build.log`.

Lệnh chạy lại tại `apps/windows-worker`: `npm test`, `npm run typecheck`, `npm run format:check`, `npm run test:native`, `npm run build`, `node scripts/run-acceptance.cjs images-ui`, `node scripts/run-acceptance.cjs chat-host-ui`.

**Không gọi model thật trong đợt này.** Test SDK capture request và fixture Electron chứng minh đường dữ liệu, không chứng minh 9Router/model hiện tại đọc ảnh đúng hoặc chất lượng suy luận thị giác. Không xác định model text-only là vision qua tên model. Mermaid, remote PR/issues và UX-08 lịch/quy tắc còn lại; 3D và WW-5 tiếp tục tạm dừng.

## Source chính

`shared/images.ts`, `shared/chat.ts`, contracts/channels/preload; `electron/images.ts`, `storage/images.ts`, `storage/database.ts`, `storage/conversations.ts`, `controller/runs.ts`, `runtime/opencode.ts`, permissions/security, `main.ts`; `src/features/ChatImages.tsx`, `ChatHost.tsx`, `FollowUpCard.tsx`, `images.css`, CSP; `tests/images.test.ts`, fixture migration và `scripts/acceptance-images-ui.cjs`.
