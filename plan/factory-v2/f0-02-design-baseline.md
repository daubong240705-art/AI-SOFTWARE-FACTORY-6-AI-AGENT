# F0-02 — Bộ chuẩn giao diện và fixture offline

Ngày **06/11/2026** · baseline `946872e` · checkpoint `checkpoint/factory-v2-ux0-20261106` · nhánh `feature/factory-v2-foundation`.

**Done trong phạm vi F0-02:** tokens, resource Việt–Anh, checklist từng màn, component/window states và seed data đã lưu cùng source và xác thực. Chưa xây Host/UI React V2 hoặc runtime. [Yêu cầu UI/UX mới](uiux-upgrade.md) thay palette/font/dock nguyên mẫu; các giao diện thật sẽ triển khai ở F2/F3.

## Đầu ra và quyết định

- [Design baseline](../../design/factory-v2/README.md): Light mặc định, Dark/System; Inter self-host nguồn chính thức pin revision/hash và OFL; type body 14/20, chat 15/24, meta 12/18.
- 22 contracts, 7 view states, 8 scenarios; checklist đủ 9 ID ảnh trong atlas, ưu tiên UI-04 Board, UI-08 Dashboard và UI-03 Team. Ảnh giữ ignored local.
- Hai resource vi/en cùng 194 leaf keys và placeholders. UI đổi locale; mẫu công việc/hội thoại/đặc tả giữ ngôn ngữ gốc. Production dùng i18next theo F2-01; fixture chưa cài thư viện.
- Seed thống nhất BA lưu data/API v1 → FE/BE độc lập → QA chờ tích hợp; Lead có một câu hỏi nghiệp vụ. Không trộn tool permissions với review/decision.
- Fixture có Board/Dashboard/Team/attention/settings/guide, hai theme, custom disclosure menu; cửa sổ chat mẫu move/resize/minimize/maximize/close/restore/tray, lưu preferences/layout, giữ nháp trong bộ nhớ. Không gọi model, không dispatch, không mở DB hoặc probe runtime.
- Tách module geometry thuần khỏi preview; persistence whitelist không chứa nháp/transcript/credentials. Sáu sample agent với một cửa sổ/agent; chưa phải conversation registry production. Cửa sổ research hiển thị project mẫu của nó; chưa hỗ trợ project routing thật.

## Bằng chứng

[Report machine-readable](../../research/factory-v2/f0-02-validation.json) ghi scope và giới hạn:

| Kiểm tra thực tế | Kết quả |
|---|---|
| Build HTML offline + syntax | Pass, font/CSS/data/script nhúng local |
| Logic geometry + preview smoke | 15/15 pass; 192 tổ hợp theme/locale/page/state dựng được markup qua VM DOM stubs |
| Contrast | 24 cặp Light/Dark pass ngưỡng chữ/control đã đặt; không phải toàn bộ audit a11y |
| Font | 195 codepoints cần thiết có trong cmap, gồm NFC/NFD và U+1EA0–U+1EF9; normal variable asset + hash/license verified |
| References/seed | 9 ảnh hash/dimensions đúng tại workspace; refs và DAG hợp lệ, FE/BE cùng inputs BA |
| Source V1 | Không có thay đổi tracked trong apps/packages so với baseline |
| Browser visual/focus/pointer/performance | Chưa kiểm; Computer Use lượt trước dừng theo URL-confidence guard |
| App/runtime/model/DB/build V1 | Không chạy; không thuộc artifact thiết kế |

Kiểm font ban đầu gặp thiếu Python Brotli extension; dùng decoder built-in Node trong cùng process kiểm tra, không cài package hoặc thay môi trường hệ thống. Không dùng kiểm cmap thay bằng chứng chữ hiển thị đúng trên browser.

## Bàn giao F0-03 và F2

F0-03 chốt source boundaries, command/event/error contracts, preferences version/schema, WindowStore/ConversationStore, draft revision conflicts, project/agent/conversation IDs và adapter permissions. Sau đó F1 bootstrap Host và F2 dựng React UI dùng contracts thật.

Không mang DOM fixture hoặc Pointer Events demonstrator thành production window framework. F2 chọn primitives/shadcn/Lucide/react-rnd theo gate tương thích; i18n/tokens/seed/checklists có thể tái dùng. Menu collision/portal, tooltip/focus đầy đủ, Markdown renderer, italic font, window keyboard transaction, durable drafts, shared stream và browser matrix còn thuộc triển khai sản phẩm. F2 Alpha một Lead; F3 mới hoàn thiện nhiều agent windows. Không đánh F1/F2/F3 Done bằng kết quả F0-02.
