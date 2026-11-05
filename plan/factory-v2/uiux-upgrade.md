# Đánh giá và kế hoạch nâng cấp UI/UX AI Worker

Ngày **06/11/2026** · baseline source `70649e9` · nhánh `feature/factory-v2-foundation` · checkpoint `checkpoint/factory-v2-uiux-assessment-20261106`.

**Tiến độ sau đánh giá:** UX-0/F0-02 đã bàn giao [bộ chuẩn và fixture](f0-02-design-baseline.md). Các mô tả “còn dở/untracked” dưới đây ghi hiện trạng tại lúc đánh giá `946872e`; bước kế tiếp hiện tại là F0-03 contracts. Chưa triển khai ứng dụng Host/UI V2 thật.

**Kết luận:** nâng cấp trên hướng V2 đã thống nhất: React/TypeScript UI, một Host WSL2, API dùng chung. Giữ V1 để sử dụng và tham khảo; không chuyển cả hệ thống cửa sổ vào prototype DOM hoặc sửa runtime để phục vụ thay đổi hình thức. Bước hiện tại là đánh giá source và lập kế hoạch, chưa triển khai thay đổi lớn.

Yêu cầu mới ưu tiên **Light Theme lấy cảm hứng CrewHub, hỗ trợ Dark Theme, Inter, song ngữ và nhiều cửa sổ chat**. Những điểm này thay yêu cầu cũ bắt palette/font giống ảnh trên 90% và một chat dock duy nhất. Vòng nghiệp vụ, dữ liệu và các tiêu chí tin cậy trong [kế hoạch chính](README.md), [workflows](workflows.md) vẫn giữ. Không xây lại kế hoạch hoặc orchestrator thứ hai.

## 1. Đang có sản phẩm thật hay prototype?

| Phần | Bằng chứng từ source | Kết luận và giới hạn |
|---|---|---|
| Worker V1 `apps/windows-worker` | `package.json`: 1.3.0-alpha.8, Electron 42.11.18, React 19.3.1, TS 5.9.3, electron-vite 5.0.0, SQLite, OpenCode SDK | Có luồng ứng dụng thật trong source, không chỉ UI demo. Chưa chạy lại để khẳng định mọi tính năng hiện hoạt động |
| Bridge và persistence V1 | `electron/preload.ts` → IPC; `electron/main.ts` nối sendChat/board/questions/reports/schedules; `electron/storage/database.ts` mở worker.sqlite | Có implementation cho hội thoại, nháp, Board, output và lịch; chưa đọc/ghi DB hoặc kiểm dữ liệu live trong đợt này |
| Runtime V1 | `electron/controller/runs.ts` dùng OpenCodeRuntime, worktrees, evidence, permissions; `electron/runtime/opencode.ts` dùng SDK client | Có đường thực thi thật; chưa gọi model, chưa xác minh auth/quota hoặc kết quả thực thi mới |
| UI V1 | `App.tsx`, `ChatHost.tsx`, Board/Team/Settings và các stores | Có wiring dữ liệu, draft, retry/idempotency, attachments, Markdown. Thiết kế hiện bị gắn với Electron và mô hình role V1 |
| V2 `design/factory-v2` | `seed.json` có fixtureOnly=true; `preview.mjs` đọc JSON và trả lời giả lập; builder tạo HTML offline | Chỉ là style guide đang làm dở, không có Host/API/DB/model; không phải bản V2 dùng để giao việc |
| Source Host/UI V2 | Chưa có `apps/factory-host`, `apps/factory-ui` ở baseline | Cần F0-03/F1/F2 để thành sản phẩm; không gọi preview là runtime Alpha |
| `apps/dashboard` | Next.js 16, React 19; ứng dụng riêng | Không chọn làm target cho Worker mới; tránh kéo Next/Electron vào cùng UI V2 |

Kiểm tra danh sách process tại thời điểm khảo sát không thấy process tên chứa ASF/Electron/Factory. Điều này không xác định được phiên bản người dùng đang mở trong trình duyệt; cần đối chiếu build ID/đường dẫn khi kiểm UI thực tế. Không suy ra lỗi căn lề trực quan chỉ từ source. Lượt trước Computer Use đã dừng vì không xác định chắc URL Chrome; đợt này không thử vượt giới hạn đó.

### Tái sử dụng và tác động

| Nguồn V1 | Giữ/chuyển | Tác động khi chuyển V2 |
|---|---|---|
| `src/features/ChatMarkdown.tsx` | Giữ Markdown/GFM, skipHtml, code copy, table scroll | Tách `window.worker.openExternal`, đưa nhãn qua i18n; không thay nội dung agent |
| `src/features/ChatHost.tsx` | Chuyển logic IME, paging, scroll anchor, draft/send request IDs, attachments | Tách thành thread/composer/data transport; không copy polling/useState toàn bộ cho từng window |
| `src/ui/Select.tsx`, `Popover.tsx`, `primitives.tsx` | Giữ contracts/kinh nghiệm focus và keyboard | Đối chiếu primitive shadcn được chọn; một implementation cho mỗi control, không trộn popup hai hệ |
| `src/lib/workspace-store.ts`, `monitor-store.ts`, `run-detail-store.ts` | Giữ ý tưởng store dùng chung, subscribe/freshness | Đổi transport IPC sang Host API/event; không cho mỗi window tự probe runtime |
| `shared/*`, storage/controller | Giữ ý tưởng hồ sơ chung, evidence, version/idempotency | Không nhập nguyên schema 7 role hoặc DB V1 vào V2; theo F0-03 và reuse map |
| `src/ui/tokens.css` và feature CSS | Giữ spacing/slot kinh nghiệm hữu ích | Semantic theme mới; không copy toàn bộ selectors/màu hardcode rồi override chồng lớp |

[Reuse map F0-01](f0-01-baseline.md) vẫn là nền tảng. Typography/tokens/icon wrappers có thể sửa riêng trên V1 với rủi ro thấp hơn window/data refactor, nhưng làm đồng thời cả V1 và V2 sẽ tăng bảo trì hai bộ CSS/resources. Do hướng source V2 đã được chốt ở phiên trước và yêu cầu mới cần agent tự do/WSL, kế hoạch này tập trung V2; V1 chỉ sửa lỗi chặn sử dụng nếu phát sinh. Đổi font/theme không làm có thêm adapter hoặc nhiều conversation độc lập.

## 2. Vấn đề và ưu tiên

| Mã | Mức | Phát hiện / tác động | Cách xử lý |
|---|---|---|---|
| UX-A01 | P0 trước code UI | Preview V2 dễ bị hiểu là ứng dụng thật; một số nút chỉ mở thông báo | Giữ nhãn dữ liệu mô phỏng, liệt kê chức năng chưa nối; Alpha chỉ expose luồng thật |
| UX-A02 | P0 | `App.tsx` giữ một conversationId/chatDock; `.chat-host.dock` fixed right/top/bottom, z-index 25 | Tách conversation store và window store, rồi thêm drag/resize; không nhân bản nguyên ChatHost |
| UX-A03 | P0 | Mỗi ChatHost hiện có polling hội thoại 400 ms khi visible | Không mở nhiều bản polling độc lập. Một data channel/store dùng chung, subscribe theo conversation |
| UX-A04 | P1 nền UI | `ui/tokens.css` chỉ color-scheme dark; `chat.css` còn màu hex trực tiếp | Semantic tokens cho hai theme, cả Markdown/diff/menu/dialog; tránh chỉ đổi màu body |
| UX-A05 | P1 nền UI | Segoe UI + nhiều cỡ 10/11/12/13/14 px; preview đề xuất Archivo nhưng chưa bundle font | Inter self-host có tiếng Việt, thang chữ thống nhất; đo glyph và wrap trước khi chốt asset |
| UX-A06 | P1 nền UI | Nhãn tiếng Việt nằm trong ChatHost, Settings, Markdown, stores; chưa thấy cấu hình i18n trong target | Resource vi/en, key có kiểu, UI lỗi theo code; không dịch output agent |
| UX-A07 | P1 | Lucide đã có nhưng icon size/tooltip/slot chưa thành contract chung | IconButton + Tooltip + slot kích thước; audit mọi action/route |
| UX-A08 | P1 | Select/Popover đã custom, có keyboard/Escape/outside click; chưa kiểm browser mới | Tái dùng contracts và behavior hữu ích, kiểm collision/portal/focus trước quyết định giữ implementation |
| UX-A09 | P1 | Settings V1 chỉ models/runtime/data; không có appearance/language | Settings → Giao diện & ngôn ngữ; preferences độc lập runtime credentials |
| UX-A10 | P1 | Role schema V1 bắt đúng 7 agent, ChatHost gắn window.worker và Role | V2 dùng agentId/runtime capabilities, transport adapter; không copy schema cũ vào UI mới |
| UX-A11 | P2 | Chưa có số đo nhiều cửa sổ, resize/zoom/Markdown và stream đồng thời | Dataset/performance/keyboard acceptance trước khi công bố hoàn thiện |

P0 nghĩa là chốt ranh giới trước triển khai, không phải phát hiện sự cố production mới. Không thay đổi ownership, cấp quyền Bash hoặc review policy trong đợt UI.

## 3. Chọn thư viện và phạm vi dùng

Các nguồn được đọc ngày 06/11/2026; đây là đánh giá tài liệu/source, **chưa cài và chưa xác minh tương thích bằng build**. Version sẽ pin vào lockfile V2 ở ticket triển khai, không dùng version nhánh main như bản đã kiểm chứng.

| Thành phần | Quyết định | Lý do / điều kiện |
|---|---|---|
| React/TypeScript/Vite | Giữ hướng V2 | Phù hợp UI hiện có; transport tách Electron IPC, không đổi Host/queue |
| shadcn/ui | Dùng chọn lọc cho primitives V2 | [Docs](https://ui.shadcn.com/docs) phân phối component source; [Vite guide](https://ui.shadcn.com/docs/installation/vite) có lộ trình tích hợp. Chốt một bộ primitive nền, ví dụ Radix, tránh trộn hai bộ hành vi cho cùng control. Tailwind chỉ scoped trong app V2; không migrate CSS V1 hàng loạt |
| react-rnd | Ứng viên ưu tiên cho floating chat | [API](https://github.com/bokuweb/react-rnd) có controlled position/size, handle, bounds và callbacks. [Source](https://github.com/bokuweb/react-rnd/blob/master/src/index.tsx) dùng react-draggable/re-resizable: vẫn cần state manager, keyboard, focus, persistence, clamping do app xử lý. Gate React 19/StrictMode, zoom, touch, pointer cancel trước tích hợp |
| dnd-kit | Chưa thêm cho chat | [Tài liệu](https://dndkit.com/) tập trung drag/drop/sort. Phù hợp Board sau này; không cung cấp trọn hệ cửa sổ resizable. Không cài đồng thời chỉ để kéo chat |
| i18next + react-i18next | Chọn cho UI V2 | [Hook](https://react.i18next.com/latest/usetranslation-hook) và [plural rules](https://www.i18next.com/translation-function/plurals) giải quyết namespace/interpolation/plural; dùng resource local, không cần translation backend |
| Lucide React | Tiếp tục sử dụng | Đã có trong V1; [React guide](https://lucide.dev/guide/react) hỗ trợ SVG component; named imports, không tải cả icon registry |
| Magic UI | Chỉ tham khảo hiệu ứng, chưa thêm | [Docs](https://magicui.design/docs) hướng nhiều tới landing/marketing. Dashboard không cần particles, marquee, typewriter, glow hoặc animation số liệu liên tục |
| Motion | Có điều kiện, CSS trước | Transition 120–180 ms đủ cho hover/menu/window. Chỉ thêm nếu cần exit/layout animation mà CSS không đủ; [reduced-motion](https://motion.dev/docs/react-accessibility) bắt buộc |
| Markdown/GFM | Giữ hướng hiện có | Tái dùng skipHtml, table scroll, code copy, IME/auto-scroll; thay bridge openExternal bằng browser/Host policy phù hợp. Chưa thêm syntax highlighter nặng nếu chưa cần |

Giấy phép đã đọc: shadcn/ui và Magic UI bản OSS MIT; react-rnd package khai báo MIT; Inter OFL-1.1; Lucide hiện công bố ISC. Giữ notices đúng artifact/version khi thực sự đưa vào source. Không dùng Magic UI Pro như tài nguyên OSS. Chưa copy code/font/icon từ các nguồn trong đợt đánh giá. Giấy phép các dependency phụ và phiên bản i18n phải được ghi vào inventory khi pin, không coi đánh giá trên là kiểm toán toàn bộ dependency tree.

Nếu react-rnd không qua gate React/zoom/keyboard: dùng adapter Pointer Events nhỏ cho cùng geometry contract; không đổi conversation model hoặc dựng framework window manager khác. shadcn không tự quản lý cửa sổ chat hoặc lifecycle agent.

## 4. Design System đề xuất

### Theme và typography

Light là mặc định cài mới; Settings cho Light / Dark / Theo hệ thống. Lựa chọn rõ của user ưu tiên hơn OS. Hai theme dùng chung semantic keys: canvas, surface, raised, foreground, muted, border, controlBorder, focus, primary/onPrimary, accent/onAccent, success/warning/danger và các surface tương ứng. Không dùng màu trạng thái làm chữ nhỏ nếu contrast thiếu.

Palette dưới đây là **đề xuất ASF**, chưa đo từ ảnh CrewHub Light và chưa là tokens đã triển khai:

| Vai trò | Light | Dark |
|---|---|---|
| Canvas / panel / raised | #F6F7F9 / #FFFFFF / #F0F2F5 | #232323 / #2C2C2C / #333333 |
| Chữ / chữ phụ | #20242C / #596273 | #FDFDFD / #B9B9B9 |
| Divider / control boundary | #DEE2E8 / #7A8493 | #3D3D3D / #777777 |
| Primary / chữ trên primary | #20242C / #FFFFFF | #FDFDFD / #232323 |
| Accent nhẹ / chữ | #FFE5E7 / #9F2734 | #FE676F / #232323 |
| Focus | #9F2734 | #FDFDFD |

Accent Light ưu tiên indicator/tint, không tô đỏ cả toolbar. Shadow chỉ cho floating windows/menu; card thường dùng border mảnh. Đo WCAG: chữ thường ≥4.5:1, chữ lớn ≥3:1, focus/biên control cần phân biệt ≥3:1 với nền kề. Divider trang trí không thay thế boundary/focus. Trạng thái có text/icon, không chỉ màu.

Chọn **Inter Variable** làm body ứng viên chính: [nguồn chính thức](https://rsms.me/inter/) có thiết kế cho UI và nhiều glyph; [OFL](https://github.com/rsms/inter/blob/master/LICENSE.txt) cho phép bundle theo điều kiện license. Geist là phương án so sánh từ [Vercel](https://vercel.com/font), không bundle cả hai nếu Inter đạt. Archivo là đề xuất cũ đã được thay. Tự host WOFF2 trong app, đủ Latin/Vietnamese, không gọi Google Fonts/CDN lúc chạy. Fallback system-ui; monospace ui-monospace/Consolas cho code và ID.

| Loại chữ | Size / line-height | Weight / cách dùng |
|---|---|---|
| Nội dung UI | 14 / 20 px | 400; controls 500 |
| Chat / tài liệu | 15 / 24 px | 400, đoạn cách 12 px; không căn đều hai bên |
| Metadata | 12 / 18 px | 400/500; không dùng 10 px cho thông tin cần đọc |
| Heading màn / section | 24 / 32, 18 / 26 px | 600 |
| Code | 13 / 20 px | Monospace, scroll ngang trong block |

Weights 400/500/600; không letter spacing rộng cho tiếng Việt. Test NFC/NFD và chuỗi “Tiếng Việt: Đặng, Nguyễn, Ắ ằ ễ ộ ự; English: workflow, review, 1,234.56”, italic/bold/inline code/table/list/link. Chờ kiểm font artifact trước đánh dấu đủ glyph. Chat line length tối đa khoảng 72ch khi mở lớn; code/table có vùng cuộn riêng, prose wrap cả URL/path dài.

### Layout, icons và chuyển động

- Giữ grid 4/8/12/16/24/32, control 34/40 px, sidebar 248 hoặc collapsed; title/control cùng baseline, text container min-width:0, scroll container min-height:0.
- Board chiếm chiều cao content còn lại, header cột đứng, thân cột cuộn riêng; card không kéo dài cả trang. Team dùng slots avatar/title/status/task/footer; nhóm card cùng hàng đồng đều, nội dung dài mở detail.
- Lucide 18 px / stroke 1.75 cho action, 16 cho metadata, 20 cho navigation; icon không shrink, gap 8 px. IconButton có hit area tối thiểu 32 px desktop, 44 px touch; aria-label + tooltip dịch được và hiện khi keyboard focus. Icon trang trí aria-hidden.
- Icon map: LayoutDashboard, Kanban, Users, MessageSquare, FileText, Workflow, CalendarClock, GitBranch, Settings; chat thêm GripHorizontal, Minus, Maximize2, Minimize2, X, Send, Square, Paperclip, RotateCcw. Xác nhận export ở version pin; tên icon không thay nhãn người dùng.
- Hover/focus 120 ms, mở/đóng 160–180 ms, chỉ opacity/transform; không animation vị trí trong lúc kéo. Respect prefers-reduced-motion; không nhấp nháy trạng thái hay đếm tiến độ giả.
- Menu/tooltip/dialog có portal riêng và focus trả về trigger. Arrow trong slot 16 px, padding riêng. Không dùng popup select native để thay UI đã thống nhất.

## 5. Hệ cửa sổ chat

### Ranh giới dữ liệu

`ConversationStore` giữ messages/drafts/pending sends theo conversationId. `ChatWindowStore` chỉ giữ hình học/trạng thái trình bày. `ChatWindowLayer` render frame dùng chung; `ChatThread`/`Composer` nhận transport/store, không biết Electron. Window manager là module UI, không điều phối task hoặc chạy runtime.

Metadata dự kiến: schemaVersion, windowId, projectId, agentId, conversationId, bounds{x,y,width,height}, restoreBounds, mode=floating|minimized|maximized, lastFocusedAt. Registry giữ activeWindowId và thứ tự mở; đóng loại khỏi registry, có lịch sử mở gần đây. Không tạo conversation mới chỉ vì mở lại một cửa sổ. Agent/runtime/model/context đọc từ record thật, không copy dữ liệu vào window state rồi để stale.

| Thao tác | Hành vi phải có |
|---|---|
| Mở từ Team/avatar/Board/chat launcher | Focus cửa sổ cùng project+agent+conversation nếu đã mở; nếu chưa có conversation thì create bằng command idempotent. “Hội thoại mới” là action riêng |
| Kéo | Chỉ header handle; không kéo từ text/composer/menu/button. Pointer capture/cancel phải kết thúc drag sạch; position tính theo workspace CSS px |
| Resize | Cạnh/góc, min 360×320, mặc định khoảng 440×560 nhưng clamp theo content; không resize cả app; giữ composer và scroll anchor |
| Thu nhỏ / khôi phục | Đưa vào tray có tên agent + unread + trạng thái; restore giữ geometry/draft/scroll; không dừng run |
| Đóng | Flush/preserve nháp rồi ẩn cửa sổ; không xóa conversation hay stop agent. Nếu lưu nháp lỗi, giữ nháp và thông báo retry; Stop là action riêng |
| Mở lớn | Chiếm content workspace; giữ restoreBounds, quay lại được; không bắt browser fullscreen |
| Focus/z-order | Pointer hoặc keyboard nâng window trong layer 100–199; menu 300, modal 400, tooltip 500; không tăng z-index vô hạn. Modal có focus trap; floating panel không modal dùng region có nhãn |
| Menu trên cửa sổ | Portal ngoài transform/overflow của frame; tránh bị clip, không làm mất tương tác cửa sổ khác sau đóng |
| Màn hình nhỏ / zoom | <768 px một chat active dạng full content, các cửa sổ khác vẫn trong tray; không cố xếp nhiều khung 360 px vào viewport nhỏ |
| Chống che / lạc cửa sổ | Spawn lệch 24 px, clamp cả frame vào content khi đủ chỗ; reserve tray/header; auto-arrange/cascade/reset là action. Cho phép overlap có chủ đích nhưng header/tray luôn tìm được |
| Đổi dự án | Chỉ hiện windows thuộc project đang xem; nháp và run project khác giữ nguyên; tray/global badge phân biệt phạm vi, không gửi nhầm |

Quan sát workspace bằng ResizeObserver; đổi sidebar, viewport, zoom hoặc restore từ màn lớn đều clamp lại. Công thức clamp: width/height tối đa available content, x/y trong 0…available−size; nếu available nhỏ hơn min thì chuyển full content. Không áp minimum cứng làm tràn màn hình. Không lưu geometry theo physical screen/DPR.

Không bắt người dùng chỉ thao tác bằng chuột: menu Window có Di chuyển/Đổi kích thước, Arrow step 8 px, Shift+Arrow 1 px, Enter chốt, Escape hủy; không áp phím này khi gõ composer. “Cửa sổ tiếp theo” có nút/shortcut riêng không cướp Alt+Tab OS. Đóng/thu nhỏ trả focus về launcher/tray; phục hồi vào vùng trước đó. Layout reset luôn truy cập được từ Settings.

Preferences lưu localStorage có schema/version theo app/Host identity; hình học thêm project scope. Chỉ lưu window IDs/bounds/mode và theme/language, không lưu transcript, attachments hoặc credentials trong layout. Handle quota/corrupt/disabled storage bằng fallback bộ nhớ + thông báo gọn. Nháp/messages bền vững do Host quản lý; fallback nháp khi mạng lỗi phải tách biệt, có giới hạn và không ghi đè nháp mới hơn. Không restore rồi auto-send hoặc auto-run. Xung đột nháp nhiều tab xử lý revision/409; không silently last-write-wins.

### Hiệu năng

Một kết nối event stream Host cho mỗi UI client, fan-out trong store theo conversationId; event cursor/dedup dùng contracts F0-03. Không tạo polling 400 ms cho mỗi cửa sổ. Hidden/minimized windows không render stream token, vẫn cập nhật unread/status ở store. Chỉ persist bounds sau drag/resize end, cập nhật pointer qua frame scheduling, không ghi DB/localStorage mỗi pixel. Subscribe theo conversation, cache Markdown theo message revision; render phần đã tải, paging history. Thêm virtualization khi đo thấy cần, không thêm framework state mới mặc định.

Mục tiêu nghiệm thu: 5 chat visible, 10 cửa sổ mở gồm minimized; khi hết diện tích, mở qua tray/auto-arrange, không từ chối tạo conversation. Kiểm 2 stream đồng thời, 1.000 messages/conversation phân trang, Markdown dài. P95 thao tác UI ≤150 ms, p95 frame khi kéo ≤32 ms trên máy/browser/resource profile được ghi; không dùng model latency để đo UI. Đây là mục tiêu chưa đo, không cam kết benchmark đã đạt.

## 6. Kiến trúc song ngữ

Đích `apps/factory-ui/src/i18n/` gồm init.ts, locales/vi/*.json và locales/en/*.json. Namespaces: common, navigation, settings, chat, tasks, agents, reports, automations, setup, errors. Component chỉ gọi key, ví dụ chat.actions.minimize; aria-label, tooltip, toast, empty/error, validation cũng qua resources. Dữ liệu agent/user/project/status tự đặt không dịch tự động.

Mặc định cài mới vi; chọn vi/en tại Settings và lưu preference versioned. Set document.lang, dùng Intl.DateTimeFormat/NumberFormat/RelativeTimeFormat theo locale đã chọn; timezone là preference riêng, không thay timezone lịch khi đổi ngôn ngữ. Tải resources đóng gói local, đổi ngôn ngữ không reload hoặc reset form/selection/windows.

Host trả error code + structured params; UI dịch error đã biết, giữ chẩn đoán kỹ thuật trong disclosure. Không nhét server message bất kỳ làm translation key. React escape interpolation; không đưa text dịch vào dangerouslySetInnerHTML. i18next count/plural cho tiếng Anh, không nối số + fragment. CI kiểm key parity, placeholder parity và plural theo locale (không đòi vi có cùng hậu tố plural với en), missing-key và chuỗi hardcode UI; cho phép ngoại lệ được nêu cho brand/agent text/code. Conversation/output/log nguyên văn, chỉ dịch chrome UI; dịch nội dung là action riêng nếu user yêu cầu.

## 7. Kế hoạch triển khai gắn backlog hiện có

Các mã UX dưới đây là **workstream trong ticket F**, không cộng thành backlog song song. Chưa đánh hoàn thành F0-02 vì prototype/tokens còn cần cập nhật yêu cầu mới và xác thực.

| Bước / ticket gốc | Công việc và file đích dự kiến | Phụ thuộc | Nghiệm thu / rollback |
|---|---|---|---|
| UX-0 · F0-02 | Chỉnh design tokens Light/Dark, typography Inter, vi/en resource mẫu, window states và fixtures; giữ 9 ảnh làm atlas hình học | Đánh giá này | JSON/schema/contrast/resource checks; preview ghi rõ simulation, không claim runtime. Checkpoint rồi commit riêng |
| UX-1 · F0-03 | ADR boundary WindowStore/ConversationStore/transport; preferences/error/event/draft revisions | UX-0 cho UI contract | Một dispatch và một conversation source; UI preferences không thay credentials. Chưa mở DB V1 |
| UX-2 · F2-01 | Scaffold UI theo F0-03; Inter/license, semantic CSS vars, Light/Dark/System, vi/en, primitives chọn lọc shadcn, Lucide/IconButton/Tooltip, Settings appearance | F0-03; không chờ runtime để làm components | 2 theme × 2 locale, keyboard/contrast/glyph; không hardcoded visible labels. V1 không đổi; rollback commit UI |
| UX-3 · F2-03 | WindowStore, frame react-rnd adapter, single Lead thread/draft, tray/focus/persist/clamp, full content mobile | UX-2; F1-03/04 và F2-02 cho chat thật | Kéo/resize/minimize/close/restore không mất nháp hoặc tạo send mới; thiếu Host chỉ dùng story/fixture có nhãn |
| UX-4 · F3-01/05 và F2-03 extension | Multi-agent chat launcher từ Team/Board, multi-conversation subscriptions, agent scopes/capability guards | F3-01 agent model + UX-3 | 5 visible/10 open; project isolation, 2 stream không nhân polling/send. Mở chat không tự dispatch công việc |
| UX-5 · F7-03/04, kiểm tăng dần từ F2 | Density/alignment Board/Team, long content, portal, zoom/responsive, stream/render benchmarks, animation nhẹ nếu cần | UX-2–4; screens triển khai dần | Không overlap/clipping không kiểm soát; matrix bên dưới pass, số đo có evidence, không thêm animation khi còn lỗi |

Đường sản phẩm vẫn F0 → F1/F2 → F3… theo [delivery plan](delivery-plan.md). F2 Alpha chỉ một Lead; multi-agent windows hoàn chỉnh ở F3, không yêu cầu chờ toàn F7 mới có giao diện dễ dùng. Mỗi lát cắt checkpoint → implement → lint/typecheck/build liên quan → test → sửa tối đa 3 vòng/issue → report/commit. Không chạy script repo ngoài chưa xem xét; version/dependency/license review trước install.

## 8. Ma trận nghiệm thu

| Nhóm | Cases bắt buộc |
|---|---|
| Theme × locale | Light/Dark × vi/en trên shell, Settings, Board, Team, chat, Markdown, menu, dialog, toast; System theo OS; reload không flash theme sai; font offline |
| Responsive | 1600×1000, 1440×900, 1366×768, 1024×768, 390×844; zoom 100/125/200%, keyboard-only và IME tiếng Việt |
| Geometry | Kéo bốn cạnh, resize min/max, sidebar đổi độ rộng, mở lại từ màn lớn, reset layout, pointercancel; header/composer luôn thao tác được |
| Lifecycle | Mở lại focus cùng window, close/minimize không stop, Stop rõ phạm vi, restore draft/scroll, navigation không mất nội dung, storage corrupt/disabled |
| Data | Send/retry/reconnect cùng request ID không trùng; reply đúng conversation/agent/project; 2 tab nháp conflict, không auto-send sau restore |
| Accessibility | Focus ring/contrast, tooltip khi focus, menu Escape/return focus, nonmodal regions, keyboard move/resize, reduced motion; không trap focus trong floating chat |
| Content/performance | Markdown/code/table/path/tên Việt dài, empty/error/stale/offline, 5 visible/10 open, 2 stream, history paging, query/event/render budgets |

Light không có ảnh baseline local đã xác minh nên dùng contract/chất lượng/consistency của ASF; không bịa số “giống CrewHub Light 90%”. Bộ 9 ảnh dark giữ làm tham chiếu hình học; palette/font/window behavior là sai khác có chủ đích. Business gates hiện có vẫn bắt buộc. Chỉ báo pass có commands/môi trường/screenshot hoặc kết quả đo tương ứng; UI chưa chạy thì ghi chưa kiểm.

## 9. Kết quả và bước kế tiếp

Đợt này đã kiểm source/UI contracts/persistence/runtime wiring, đọc tài liệu chính thức và một phần source react-rnd, chốt cách nâng cấp và cập nhật đầu mối kế hoạch. Không mở DB, gọi model, cài dependency, đổi settings live hoặc sửa source app. Không có bằng chứng build/test/visual mới của ứng dụng; không đánh giá runtime production là pass.

[Bằng chứng khảo sát và kiểm tra tài liệu](../../research/factory-v2/uiux-assessment.json) ghi source hashes, nguồn đã đọc, baseline và phạm vi chưa kiểm. Các path design đang untracked là WIP từ F0-02, chưa được đưa vào commit đánh giá này.

**Bước tiếp theo là UX-0 trong F0-02:** cập nhật style guide còn dở sang Light/Dark + Inter + vi/en + states cửa sổ, xác thực bộ chuẩn rồi commit riêng. Sau đó F0-03 chốt contracts trước xây UI thực. Không cần chuyển ứng dụng đang dùng sang prototype.
