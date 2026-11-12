# 15 · Adapter CLI cục bộ (Codex, Claude Code) trên node Windows, theo cách Paperclip

| Mục | Nội dung |
|---|---|
| Trạng thái | **Bản đề xuất 12/11/2026, chờ người dùng duyệt** (chưa lập trình) |
| Yêu cầu của người dùng | Agent hoạt động như Claude Code / Codex CLI trên máy Windows này, không giới hạn khả năng; chỉ duyệt ở tầm kết quả (tài liệu, ý tưởng, kế hoạch, review, quyết định), không duyệt từng lệnh hay lỗi vặt; đăng nhập bằng thuê bao Claude và ChatGPT; làm "như Paperclip" |
| Liên quan | [03 node phân tán](03-distributed-worker.md), [00 OSS-02, ADR-T06, AP-11](00-decision-register.md), [oss-options §6G](oss-options.md), [12 ngữ cảnh](12-context-engineering.md) |
| Nguồn tham khảo | Mã Paperclip (MIT) trong `.cache/asf-research/sources/paperclip/packages/adapters/{claude-local,codex-local}` và `docs/adapters/` |

## 1. Paperclip làm gì (rút từ mã, 12/11/2026)

| Chủ đề | Cách Paperclip làm |
|---|---|
| Runtime | Chạy **chính CLI đã cài** (`claude`, `codex`) bằng adapter `*-local`; có đường ACP và đường chạy qua SSH hoặc sandbox. Không có agent loop riêng |
| Đăng nhập Claude | Ba cách, ưu tiên theo thứ tự: `ANTHROPIC_API_KEY`; `CLAUDE_CODE_OAUTH_TOKEN` (mã dài hạn từ thuê bao, sinh bằng `claude setup-token`, có trình chạy dẫn đường: hiện URL, nhận mã dán, giao token một lần rồi xóa khỏi bộ nhớ); hoặc đăng nhập thuê bao sẵn có trên máy |
| Đăng nhập Codex | `OPENAI_API_KEY` theo từng agent (ghi vào `auth.json` riêng); hoặc **đăng nhập ChatGPT của máy chủ** (liên kết `auth.json` của máy vào thư mục riêng của agent để mã làm mới luôn mới nhất); hoặc `CODEX_HOME` tự quản. Có luồng "device login" |
| Bí mật | Coi mọi byte luồng terminal là bí mật: giữ trong bộ nhớ, xóa ngay, không ghi log, không ghi artifact; lưu `auth.json` quyền 0600 qua đổi tên nguyên tử có khóa thư mục |
| Hạn mức | Dò hạn mức thuê bao (`quota-probe`), phân loại lỗi (thiếu đăng nhập, hết hạn mức kèm giờ làm mới, giới hạn tốc độ, hết lượt, ngân sách) thay vì thử lại mù |
| Đồng thời | Khuyên dùng **khóa API riêng cho mỗi agent** khi chạy song song nhiều agent; nhiều tiến trình dùng chung một đăng nhập thuê bao có mã làm mới xoay vòng sẽ lỗi |
| Quyền | Có cấu hình quyền cho từng agent (`permissions.ts`), gồm chế độ bỏ qua hỏi quyền |
| Workspace | Hợp đồng "không dựa vào git remote": thư mục làm việc cục bộ là nơi lưu trạng thái giữa các lần chạy; chạy ở máy khác thì đồng bộ qua/vào rồi đồng bộ ngược; adapter **không bao giờ `git push`** |
| Kỹ năng | Adapter nạp kỹ năng vào thư mục chủ của CLI |

## 2. Cái Factory học và cái Factory giữ khác

**Học nguyên tinh thần:** chạy CLI thật, kết nối AI có nhiều kiểu xác thực, luồng đăng nhập dẫn đường không để lộ bí mật, dò hạn mức và phân loại lỗi, khóa API cho song song, quyền cấu hình theo agent, adapter không đẩy mã.

**Giữ khác (đã duyệt từ trước, không đổi):**
- Factory vẫn là **bộ điều phối có chủ**: việc, review của người, nhánh tích hợp, ngân sách, hiệu ứng ngoài (đẩy mã do Host làm tới remote người dùng khai báo).
- **Host ở WSL, CLI ở Windows**: cần node Windows nối ra Host (khác Paperclip chạy tất cả trên một tiến trình).
- Bí mật **không nằm trong cơ sở dữ liệu của Host** và không hiện lại trên giao diện sau khi nhập.

**Bản quyền:** Paperclip theo MIT. Factory **viết lại theo thiết kế**, chỉ chép nguyên văn những đoạn nhỏ cần thiết, kèm thông báo bản quyền trong `packs/NOTICE.md` hoặc đầu file (OSS-17 bên dưới). Không kéo `@paperclipai/*` vào làm phụ thuộc.

## 3. Thiết kế

### 3.1 Node Windows
Một dịch vụ Node (`factory-node`) chạy trên máy này, dưới tài khoản Windows hiện tại (tùy chọn tài khoản riêng sau). **Nó kết nối ra Host** (không mở cổng vào), đăng ký bằng mã dùng một lần, gửi nhịp tim, số slot, phiên bản CLI, tình trạng đăng nhập của từng kết nối. Trang Đội đã có chỗ hiển thị.

### 3.2 Kết nối AI (AI connections)
Mỗi kết nối có: nhãn, hãng (`codex` hoặc `claude`), kiểu xác thực, node chứa nó, trạng thái, lần kiểm tra cuối. Kiểu xác thực:

| Hãng | Kiểu | Bí mật ở đâu |
|---|---|---|
| Codex | `chatgpt-login` (mặc định, dùng `~/.codex/auth.json` do `codex login` tạo) | Trong thư mục Codex của tài khoản Windows, quyền chỉ chủ sở hữu |
| Codex | `api-key` | Windows DPAPI (mã hóa theo người dùng) trên node |
| Claude | `setup-token` (mã dài hạn từ thuê bao) | DPAPI trên node |
| Claude | `api-key` | DPAPI trên node |
| Claude | `cli-login` (đăng nhập `claude` sẵn có) | Thư mục `~/.claude` |

Quy tắc ưu tiên như Paperclip: khóa API cho từng agent > mã dài hạn > đăng nhập sẵn có.
**Host chỉ lưu siêu dữ liệu** (kiểu, trạng thái, hạn dự kiến). Giao diện chỉ hiện trạng thái (đã đăng nhập, sắp hết hạn, hết hạn mức), không bao giờ hiện bí mật.
**Luồng dẫn đường** (Cài đặt → Kết nối AI): Codex "device login" (hiện URL và mã, node chờ hoàn tất); Claude `setup-token` (hiện URL, người dùng dán mã, node nhận token, lưu DPAPI, xóa khỏi bộ nhớ). Toàn bộ chạy **trên node**, Host chỉ chuyển tiếp thông báo trạng thái.

### 3.3 Adapter
Giao diện chung (mở rộng `RuntimeAdapter` đã có, runtime `acp` hoặc `local-cli`): `probe()` (CLI có không, phiên bản, đã đăng nhập, hạn mức), `models()`, `execute(attempt)`, `cancel()`. Hai adapter đầu: `codex-local` (dùng `codex exec --json`, `-C`, `--ephemeral`; chế độ quyền xem 3.4) và `claude-local` (sau).
Luồng sự kiện JSON của CLI được dịch sang sự kiện attempt hiện có (tiến độ, gọi công cụ, kết quả) để giao diện hiện trực tiếp.
**Phân loại lỗi** thay vì thử lại mù: `auth-missing`, `quota-exhausted` (kèm giờ làm mới), `rate-limited`, `cli-missing`, `cli-version`, `timeout`. Với `auth-missing` và `quota-exhausted`: tạm dừng agent, báo chuông thông báo (nhân vật Lead ở trạng thái "cần chú ý"), **không tự thử đăng nhập lại**, không vòng lặp.

### 3.4 Quyền và tự do (theo yêu cầu người dùng)
Mặc định của node: **tự chủ, không hỏi từng lệnh**. Với Codex: `--dangerously-bypass-approvals-and-sandbox` (có trong 0.166.0) hoặc `-s danger-full-access` kèm chế độ không hỏi. Với Claude Code: chế độ bỏ qua hỏi quyền. Bật bằng một công tắc **trên node**, người dùng xác nhận một lần (ghi vào cấu hình node, hiện nhãn "Toàn quyền" ở trang Đội). Hạ xuống "hỏi từng lệnh" chỉ là cấu hình, nhưng yêu cầu hỏi sẽ không có chỗ trả lời, nên dùng được chủ yếu cho thử nghiệm.
**Chốt cửa bằng thông tin đăng nhập, không bằng lệnh:** việc không nên cho agent tự làm (máy chủ production, tiền, xóa dữ liệu ngoài dự án) thì khóa SSH, token tương ứng **không có trong tài khoản chạy node**; hành động đó đi qua hiệu ứng của Host và cần người dùng duyệt (đã có Standing Approval và danh sách cấm vĩnh viễn).

### 3.5 Workspace
Theo hợp đồng "không dựa vào git remote" của Paperclip: Host gửi **gói git (bundle)** của nhánh gốc xuống node; node tạo worktree trên đĩa Windows, chạy agent, trả các commit mới về dưới dạng bundle; Host áp vào nhánh của việc rồi đi theo luồng review và nhánh tích hợp đang có. Adapter không `git push`.

### 3.6 Hồ sơ, kỹ năng, công cụ Factory
Hồ sơ và kỹ năng của gói đội (đã ghim bằng mã băm) được ghi vào thư mục chạy của CLI (`AGENTS.md` / `CLAUDE.md` và thư mục kỹ năng) ở **thư mục chạy tạm, không phải trong repo**. Công cụ MCP của Factory (tiến độ, đăng ký đầu ra, tri thức, yêu cầu) được CLI gọi qua một cầu nối cục bộ trên node chuyển về Host bằng mã thông báo của attempt (như attempt OpenCode hiện nay).

### 3.7 Song song
Mỗi node khai báo số slot. Với kiểu `chatgpt-login` và `cli-login`: **slot mặc định là 1** vì một đăng nhập thuê bao có mã làm mới xoay vòng dùng chung. Muốn chạy song song nhiều agent: chuyển sang khóa API cho từng agent, như khuyến nghị của Paperclip.

## 4. Lát việc đề xuất (M4-A)

| Lát | Nội dung | Nghiệm thu |
|---|---|---|
| A1 | Node Windows: dịch vụ, đăng ký bằng mã, nhịp tim, slot, `probe` CLI; trang Đội hiện node thật | Node lên trong trang Đội, báo phiên bản Codex và trạng thái đăng nhập |
| A2 | Giao thức Host ↔ node, hàng đợi việc, bundle xuống và lên, hủy | Một việc giả chạy trọn vòng qua node, commit trả về Host |
| A3 | Adapter `codex-local`: chạy `codex exec --json`, dịch sự kiện, phân loại lỗi, cấu hình quyền | Một việc thật nhỏ làm xong, hiện sự kiện trực tiếp, review và gộp như việc OpenCode |
| A4 | Kết nối AI: bảng siêu dữ liệu, giao diện trạng thái, luồng device login Codex, dò hạn mức | Hết hạn mức hoặc mất đăng nhập tạm dừng agent và có thông báo, không vòng lặp |
| A5 | Hồ sơ, kỹ năng, cầu nối MCP cho CLI | Agent Codex đọc hồ sơ vị trí, đăng ký được đầu ra |
| A6 | `claude-local` và luồng `setup-token`; chọn runtime và mức quyền theo vị trí trong giao diện | Một đội có cả vị trí Codex lẫn Claude |
| A7 | Công tắc ngắt khẩn cấp, bản ghi kiểm toán, tùy chọn tài khoản Windows riêng | Ngắt một node dừng mọi attempt trên node đó |

Ước lượng: 7 lát, mỗi lát một lượt Codex cộng thử trên máy thật. A1 đến A3 là lõi (dùng được Codex trên máy này); A6 phụ thuộc quyết định điều khoản Claude.

## 5. OSS-17 (đề xuất, chờ duyệt)
Chấp thuận **học thiết kế và chép có chọn lọc** từ `paperclipai/paperclip` (MIT) cho: luồng đăng nhập dẫn đường không lộ bí mật, ưu tiên xác thực, phân loại lỗi hạn mức, hợp đồng không-git-remote, và cấu hình quyền. Mỗi đoạn chép nguyên văn phải giữ thông báo bản quyền MIT. Không dùng gói `@paperclipai/*`.

## 6. Quyết định mở và rủi ro

| # | Vấn đề | Đề xuất |
|---|---|---|
| Q1 | Điều khoản dùng thuê bao Claude trong công cụ điều phối: Anthropic (2/2026) cấm OAuth thuê bao trong công cụ bên thứ ba và Agent SDK; chưa có văn bản gốc để xác nhận cho trường hợp tự chạy `claude` | Làm Codex trước; Claude bằng khóa API hoặc chấp nhận rủi ro khóa tài khoản do người dùng quyết |
| Q2 | Điều khoản OpenAI cho việc điều phối Codex bằng đăng nhập ChatGPT | Tài liệu OpenAI khuyên khóa API cho tự động hóa; đăng nhập ChatGPT là cách chính thức của CLI trên máy cá nhân; người dùng tự xác nhận |
| Q3 | Toàn quyền trên máy này | Chấp nhận theo yêu cầu; khuyến nghị tài khoản Windows riêng; chốt cửa bằng thông tin đăng nhập (3.4) |
| Q4 | Đường dẫn Windows và WSL khác nhau cho worktree | Worktree nằm trên đĩa Windows của node; Host không đọc trực tiếp, chỉ nhận bundle |
| Q5 | Cập nhật CLI làm đổi cờ hoặc định dạng sự kiện | Ghim phiên bản CLI tối thiểu, `probe` báo phiên bản và từ chối phiên bản chưa kiểm |
