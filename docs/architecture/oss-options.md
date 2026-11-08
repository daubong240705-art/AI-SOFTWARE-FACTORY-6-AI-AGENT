# Rà soát open-source áp dụng cho kiến trúc Multi-Team

| Mục | Giá trị |
|---|---|
| Loại tài liệu | **Tài liệu sống**: cập nhật ở mỗi giai đoạn kiến trúc |
| Trạng thái | Phân tích để duyệt; chưa cài đặt, chưa thử nghiệm dự án nào |
| Lần cập nhật | 07/11/2026: rà soát cho giai đoạn 1–3; bổ sung giai đoạn 4 (§6A, §7A), giai đoạn 5 (§6B), giai đoạn 6 (§6C) |
| Baseline repo | commit `692ad3f`, branch `architecture/multi-team-research` |
| Liên quan | [01 · Tầm nhìn và Domain Model](01-product-and-domain-model.md), [02 · Cộng tác và Tri thức](02-collaboration-and-knowledge.md), [03 · Distributed Worker](03-distributed-worker.md) |

---

## 0. Phương pháp

**Cách thu thập (chỉ đọc):**
- Metadata của **52 repo** lấy từ GitHub REST API `repos/{owner}/{repo}` ngày 07/11/2026: license (SPDX), ngôn ngữ chính, số sao, ngày push gần nhất, trạng thái archived.
- README gốc của 10 ứng viên chính và spec/tài liệu gốc: `a2aproject/A2A/specification/a2a.proto`, danh sách agent của ACP, tài liệu ACP của OpenCode, docs.paperclip.ing (4 trang), file LICENSE của MCP TypeScript SDK, Orama, Mastra.
- Tìm kiếm web chỉ dùng để định hướng; mọi khẳng định quan trọng đều đối chiếu lại với nguồn gốc.
- Không cài package, không clone vào repo, không chạy thử dự án nào.

**Tiêu chí đánh giá:**

| Tiêu chí | Ưu tiên |
|---|---|
| Phù hợp stack Factory V2 | TypeScript/Node, SQLite, chạy local, Linux/WSL2 |
| License | MIT/Apache-2.0 được dùng trực tiếp; AGPL, BUSL, SSPL, proprietary chỉ tham khảo thiết kế |
| Hoạt động | Còn push trong 6 tháng gần nhất, không archived, không thông báo ngừng phát triển |
| Quy mô | Không bắt buộc broker, vector DB hay máy chủ riêng nặng ở quy mô cá nhân |
| Ánh xạ quyết định | Giải quyết trực tiếp một quyết định D-xx (tài liệu 01) hoặc C-xx (tài liệu 02) |

**Phân loại kết luận:** *Áp dụng* (đưa vào phụ thuộc hoặc chuẩn) · *Học thiết kế* (tham khảo, không phụ thuộc) · *Hoãn* (có thể xét lại khi điều kiện đổi) · *Loại*.

**Giới hạn:** GitHub API không xác thực chỉ cho 60 request/giờ. 4 repo chưa kiểm được metadata, liệt kê ở §8.

---

## 1. Tóm tắt quyết định cần duyệt

> Phương án được chọn và trạng thái duyệt ghi tại [Sổ quyết định](00-decision-register.md).

| ID | Đề xuất | Trạng thái |
|---|---|---|
| **OSS-01** | Nền tảng gốc: **tự xây Factory V2, không chạy thử Paperclip**; chỉ học thiết kế và tham khảo mã nguồn Paperclip (§2) | **Đã duyệt** 07/11/2026 |
| **OSS-02** | **ACP** làm giao thức adapter chính cho runtime; adapter native làm dự phòng (§3 O1) | **Đã duyệt** 07/11/2026 |
| **OSS-03** | Orchestrator mở **MCP server** cho tool của agent (§3 O2) | **Đã duyệt** 07/11/2026 |
| **OSS-04** | **`anthropics/sandbox-runtime`** (beta, pin version) thực thi grant trên node Linux (§3 O3) | **Đã duyệt** 07/11/2026 |
| **OSS-05** | **Agent Skills spec** làm định dạng Skill; **BMAD-METHOD/spec-kit** làm nguồn mẫu Team Pack (§3 O4, O5) | **Đã duyệt** 07/11/2026 |
| **OSS-06** | Trạng thái Cross-Team Request và Capability **ánh xạ được sang A2A v1**; chưa dùng A2A làm transport (§3 O6) | **Đã duyệt** 07/11/2026 |
| **OSS-07** | **SQLite FTS5** cho tìm kiếm tri thức; vector để sau (§3 O7) | **Đã duyệt** 07/11/2026 |
| **OSS-08** | **Giữ coordinator SQLite tự xây** theo V2; không dùng Temporal/Hatchet/Inngest/BullMQ (§3 O8) | **Đã duyệt** 07/11/2026 |
| **OSS-09** | **Litestream** sao lưu liên tục SQLite của control plane (§6A) | **Đã duyệt** 07/11/2026 |
| **OSS-10** | **WinSW** chạy node agent như Windows service (§6A) | **Đã duyệt** 07/11/2026 |
| **OSS-11** | **croner**, **cockatiel**; `dagre`, `ntfy` tùy chọn (§6B) | **Đã duyệt** 07/11/2026 |
| **OSS-12** | **Fastify**, **better-sqlite3**, **Kysely**, **pino**, **OpenTelemetry**; loại MinIO, AutoGen (§6C) | **Đã duyệt** 07/11/2026 |
| **OSS-13** | **Playwright** (E2E UI), **fast-check** (property test) (§6D) | **Đã duyệt** 07/11/2026 |
| **OSS-14** | Pack v2 và tool ngoài: **tự xây lớp khai báo mỏng** (năng lực, tool, MCP server do operator đăng ký), dùng từ vựng A2A/Agent Skills; hoãn gateway (§3 O11) | **Đã duyệt** 08/11/2026 (phương án A) |

---

## 2. Nền tảng gốc: Paperclip

### 2.1 Hiện trạng theo nguồn gốc

`paperclipai/paperclip`: MIT, TypeScript, khoảng 112 nghìn sao, push 06/11/2026, hơn 2.700 PR đã merge. Mô tả trong README: *"Open-source orchestration for teams of AI agents"*.

**Đã có (theo README và docs, chưa chạy thử):**

| Nhóm | Tính năng |
|---|---|
| Tổ chức | Nhiều company trong một deployment, org chart, nhiều người dùng, members & access |
| Nhóm | **Team Catalog**: cài sẵn nhóm agent + org structure + project + routine + skill (ví dụ executive team, product-engineering pod, product-design team, content team) |
| Công việc | Issue có company/project/goal/parent, checkout nguyên tử có execution lock, blocker dependencies, comment, documents có revision, work products, inbox, tìm kiếm toàn company |
| Thực thi | Heartbeat: hàng đợi đánh thức lưu trong DB có gộp (coalescing), kiểm ngân sách, nạp skill, gọi adapter; phiên được giữ qua khởi động lại; khôi phục có giới hạn |
| Adapter | Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Pi, Hermes, Grok, Kimi, OpenClaw (WebSocket gateway), process, HTTP, adapter plugin ngoài |
| Quản trị | Approval/review gates, decisions, budget hard-stop, pause/reassign/terminate agent, cấu hình có revision và rollback |
| Chi phí | Token/cost theo company, agent, project, goal, issue, provider, model |
| Tự động | Routines theo cron/webhook/API, chính sách concurrency và catch-up |
| Mở rộng | Plugin chạy out-of-process, MCP tool gateway, connectors, Skill Studio có lịch sử phiên bản |
| Di chuyển | Export/import tổ chức, bỏ giá trị secret |
| Vận hành | Postgres nhúng hoặc Postgres ngoài; chế độ `local_trusted` (mặc định) hoặc `authenticated` cho LAN/VPN; OpenTelemetry tùy chọn |

### 2.2 So khớp với domain model 01/02

| Khái niệm của ta | Tương ứng ở Paperclip | Mức khớp |
|---|---|---|
| Organization | Company | Khớp |
| Team | Không có thực thể Team bền vững; team là **nhánh org chart** hoặc **gói cài đặt** từ Team Catalog | Một phần |
| Engagement (Team ↔ Project) | Không thấy | **Thiếu** |
| Role | Role/title của agent, kèm reporting line | Khớp một phần (gắn với cây báo cáo) |
| Skill | Skills có version history | Khớp |
| Agent Profile / Agent Instance | Agent (cấu hình + phiên được giữ); không tách Profile khỏi Instance | Một phần |
| Worker Node | Adapter local chạy **cùng máy Paperclip**; máy khác qua HTTP/process/sandbox providers (e2b, Cloudflare, Daytona, Modal, Kubernetes...) | **Thiếu** khái niệm node trên LAN |
| Cross-Team Request | Task xuyên team qua issue + delegation; docs ghi "cross-team tasks are possible" | Một phần |
| Execution Gate | Approvals, "approve and run" | Khớp ý tưởng |
| Artifact + trạng thái tài liệu | Artifacts, documents có revision, work products | Một phần (chưa thấy Reviewed/Approved/Superseded) |
| Decision Record | Decisions | Khớp ý tưởng |
| Ngân sách theo Project/Team | Theo company/agent/project/goal/issue | Khớp |
| Mô hình tổng thể | Gần **Persistent Team trong company**, cây quản lý cứng (mỗi agent đúng một manager) | Khác Hybrid (D-01) |

### 2.3 Ràng buộc kỹ thuật

- Node ≥ 24.11 và pnpm 9.15 (WSL hiện có Node 22.23.4 theo F1-01).
- Postgres (nhúng mặc định). Khác với lựa chọn SQLite của V2.
- Chạy từ source cần Rust toolchain cho Paperclip Runner, hoặc dùng binary dựng sẵn.
- **Telemetry ẩn danh bật mặc định**; tắt bằng `PAPERCLIP_TELEMETRY_DISABLED=1` hoặc `DO_NOT_TRACK=1`.
- Upstream thay đổi rất nhanh; fork sẽ tốn công đồng bộ.

### 2.4 Phương án

| Phương án | Mô tả | Ưu | Nhược |
|---|---|---|---|
| P-A | Tiếp tục tự xây Factory V2, học thiết kế từ Paperclip | Đúng domain model 01/02, kiểm soát hoàn toàn, giữ đầu tư F0–F1 | Tự xây phần lớn những gì Paperclip đã có; thời gian dài |
| P-B | Dùng Paperclip làm nền, mở rộng bằng plugin/adapter/team template, fork khi bắt buộc | Có ngay phần lớn tính năng multi-team | Lệch mô hình (cây báo cáo thay Team + Engagement), Node 24 và Postgres, phụ thuộc upstream; bỏ phần lớn thiết kế UI F0-02 |
| **P-C (khuyến nghị)** | **Spike 1–2 ngày** chạy Paperclip trong WSL theo kịch bản ở 02 §18, chấm theo checklist, rồi chọn P-A hoặc P-B | Quyết định dựa trên bằng chứng; chi phí nhỏ so với rủi ro chọn sai | Phải cài Node 24 và Paperclip trong WSL; **cần người dùng đồng ý riêng** |

Quyết định cũ của Factory V2 là "học Paperclip, không nhập company hierarchy/control plane". Tầm nhìn multi-team (tài liệu 01) làm lý do này yếu đi, vì hierarchy và control plane giờ chính là thứ sản phẩm cần.

> **Kết quả 07/11/2026:** người dùng chọn **P-A (tự xây Factory V2), không chạy thử**. Lý do: ưu tiên kiểm soát hoàn toàn mô hình (Hybrid, Engagement, Worker Node trong LAN, tiếng Việt) và giữ stack Node 22 + SQLite + WSL. Paperclip được dùng làm nguồn tham khảo mã (MIT, giữ thông báo bản quyền khi sao chép). Mốc xét lại: sau F2 hoặc khi F3 chậm đáng kể; khi đó checklist §2.5 vẫn dùng được. Xem [Sổ quyết định](00-decision-register.md) D-02.

### 2.5 Checklist spike đề xuất

| # | Câu hỏi | Đạt khi |
|---|---|---|
| S1 | Một agent hoặc nhóm phục vụ được 2 project mà không trộn ngữ cảnh? | Có bằng chứng phiên/ngữ cảnh tách theo project |
| S2 | Gửi yêu cầu xuyên nhóm và giới hạn quyền đọc theo yêu cầu? | Nhóm nhận chỉ đọc được phần được cấp |
| S3 | Có trạng thái "sẵn sàng nhưng chờ lệnh" (Execution Gate)? | Task chờ approval và không tự chạy |
| S4 | Tài liệu có phiên bản và trạng thái tương đương Draft/Reviewed/Approved/Superseded? | Có hoặc thêm được bằng plugin |
| S5 | Chạy agent trên máy thứ hai (WSL ↔ `.60`)? | Có adapter/runner hoạt động qua mạng LAN |
| S6 | Dùng 9Router và model DeepSeek? | OpenCode adapter dùng được provider tùy chỉnh |
| S7 | Hiển thị tiếng Việt? | Có i18n hoặc thêm được |
| S8 | Tắt telemetry và chạy hoàn toàn local? | Không có kết nối ra ngoài ngoài model provider |
| S9 | Chi phí theo kịp upstream? | Đánh giá số thay đổi breaking trong 1–2 tháng gần nhất |
| S10 | Mở rộng Engagement, Worker Node, vòng đời tri thức không cần fork? | Plugin API đủ, hoặc fork nhỏ có thể chấp nhận |

---

## 3. Thành phần áp dụng trực tiếp

Áp dụng được nếu chọn P-A. Phần lớn vẫn dùng được nếu chọn P-B (ví dụ ACP, MCP, sandbox-runtime, Agent Skills).

### O1 · Agent Client Protocol (ACP): giao thức adapter cho runtime

| Mục | Nội dung |
|---|---|
| Repo | `agentclientprotocol/agent-client-protocol` (Apache-2.0, push 06/11/2026); SDK TypeScript `@agentclientprotocol/sdk` |
| Là gì | Chuẩn giao tiếp giữa client và coding agent, JSON-RPC 2.0 qua stdio; agent chạy như tiến trình con của client |
| Runtime hỗ trợ (theo danh sách agent chính thức) | Claude Agent (qua `claude-agent-acp`), Codex CLI (qua `agentclientprotocol/codex-acp`), Cursor, Gemini CLI, GitHub Copilot (public preview), OpenCode (lệnh `opencode acp` có sẵn) |
| Áp dụng | Host hoặc Worker Node làm ACP client. Mỗi Agent Instance là một tiến trình ACP. Yêu cầu quyền của agent đi về client và được tự duyệt theo effective grant |
| Quyết định liên quan | V2 D06, F1-03, F3-02; 01 §3 (Runtime Adapter) |
| Lợi ích | Một client thay vì ba adapter riêng; thêm runtime mới gần như không phải viết code |
| Rủi ro | ACP hướng tới editor; một số năng lực (resume session, child agent) khác nhau giữa runtime. `claude-agent-acp` bọc Claude Agent SDK, **không có license OSS** (điều khoản Anthropic). `zed-industries/codex-acp` đã archived; bản thay thế `agentclientprotocol/codex-acp` (Apache-2.0 theo LICENSE và package.json, TypeScript, push 06/11/2026) còn nhỏ, cần thử kỹ |
| Dự phòng | Giữ adapter native (ví dụ OpenCode server API đã kiểm ở F1-01) cho năng lực ACP chưa có |

### O2 · MCP TypeScript SDK: tool của Orchestrator cho agent

| Mục | Nội dung |
|---|---|
| Repo | `modelcontextprotocol/typescript-sdk` (đang chuyển license từ MIT sang Apache-2.0, push 05/11/2026) |
| Áp dụng | Orchestrator mở một MCP server cung cấp: `knowledge.search`, `knowledge.get`, `request.create`, `request.reply`, `decision.request`, `output.register`, `handoff.submit`, `task.progress` |
| Quyết định liên quan | 02 C-01 (giao tiếp qua Orchestrator), §8 (Context Pack), §16 (kiểm quyền ở tool); V2 workflows §4 ("Host cung cấp API/tool có schema") |
| Lợi ích | Mọi runtime đều nói MCP; kiểm quyền và idempotency nằm ở server, không trong prompt |
| Rủi ro | Phải tránh để MCP server trở thành cửa sau vượt grant; mỗi tool mutation cần actor/attempt/idempotency key như V2 đã quy định |

### O3 · Anthropic Sandbox Runtime: thực thi grant trên node Linux

| Mục | Nội dung |
|---|---|
| Repo | `anthropics/sandbox-runtime` (Apache-2.0, TypeScript, push 06/11/2026) |
| Trạng thái | **Beta research preview**, API và cấu hình có thể đổi |
| Cơ chế | Linux dùng bubblewrap và bỏ network namespace; mọi kết nối đi qua proxy HTTP/SOCKS5 có allowlist domain. Đọc: deny-then-allow; ghi: chỉ allow; mạng: chỉ allow. Có hỗ trợ macOS và Windows |
| Áp dụng | Bọc tiến trình runtime trên Worker Node theo Execution Profile (đường dẫn, mạng) |
| Quyết định liên quan | V2 F1-04, ADR-004 ("adapter phải thực sự giới hạn hoặc báo blocker") |
| Rủi ro | Beta; cần pin version và có kế hoạch gọi bubblewrap trực tiếp nếu API đổi. Cần kiểm trong WSL (bubblewrap cần user namespace) |

### O4 · Agent Skills spec: định dạng Skill

| Mục | Nội dung |
|---|---|
| Nguồn | agentskills.io (chuẩn mở có gốc từ Anthropic); repo `anthropics/skills` (không có license chung, mỗi skill có license riêng) |
| Định dạng | Thư mục có `SKILL.md` (frontmatter `name`, `description` và trường tùy chọn), cùng script/tài liệu/asset tùy chọn; nạp theo ba bước discovery → activation → execution |
| Áp dụng | Skill registry của V2 đọc và pin skill theo định dạng này |
| Quyết định liên quan | 01 §3 (Skill), D-10; V2 workflows §8 (registry tương thích SKILL.md); V1 đã dùng `skills/*/SKILL.md` |
| Rủi ro | Chi tiết trường frontmatter cần đối chiếu trang specification chính thức khi triển khai; repo spec `agentskills/agentskills` (Apache-2.0, push 04/11/2026) là nguồn đối chiếu |

### O5 · BMAD-METHOD và spec-kit: nội dung mẫu cho Team Pack

| Mục | Nội dung |
|---|---|
| Repo | `bmad-code-org/BMAD-METHOD` (MIT; "BMad" và "BMAD-METHOD" là nhãn hiệu), `github/spec-kit` (MIT) |
| Có gì | BMAD: góc nhìn product, architecture, UX, development, testing; workflow có cấu trúc, đóng gói thành skill. spec-kit: quy trình spec-driven (spec → plan → tasks) |
| Áp dụng | Chuyển thành Skill và Workflow trong Team Pack (Development Team, Architecture Team, Design Team), ghi attribution, không dùng nhãn hiệu |
| Quyết định liên quan | 01 §8 (Team Pack), 02 §13 (tài liệu requirements/ADR có trạng thái) |
| Rủi ro | Nội dung tiếng Anh, cần Việt hóa; phải kiểm license từng file khi sao chép |

### O6 · A2A v1: chuẩn tên cho yêu cầu giữa Team và Capability

| Mục | Nội dung |
|---|---|
| Repo | `a2aproject/A2A` (Apache-2.0, Linux Foundation), SDK `a2aproject/a2a-js` (Apache-2.0) |
| Từ spec gốc (`a2a.proto`) | `TaskState`: SUBMITTED, WORKING, COMPLETED, FAILED, CANCELED, INPUT_REQUIRED, REJECTED, AUTH_REQUIRED (và UNSPECIFIED); các message `Task`, `Artifact`, `AgentCard`, `AgentSkill`, `TaskPushNotificationConfig` |
| Áp dụng | Thiết kế CTR (02 §3, §5.3) và Capability (01 §3) sao cho **ánh xạ một-một** được sang A2A. Chưa dùng A2A làm transport nội bộ |
| Ánh xạ gợi ý | Submitted/Triage → SUBMITTED; InProgress → WORKING; NeedInfo → INPUT_REQUIRED; Declined/Rejected → REJECTED; Closed → COMPLETED; Cancelled/Expired → CANCELED; Escalated/Failed → FAILED. Team ≈ AgentCard, Capability ≈ AgentSkill |
| Lợi ích | Về sau có thể mở một Team cho hệ thống ngoài (hoặc thuê agent ngoài) qua A2A mà không đổi mô hình |
| Hoãn | `@a2a-js/sdk` chỉ dùng khi thật sự cần giao tiếp với hệ thống ngoài |

### O7 · SQLite FTS5: tìm kiếm tri thức

| Mục | Nội dung |
|---|---|
| Là gì | Tìm kiếm toàn văn tích hợp trong SQLite (public domain); V1 đã dùng better-sqlite3 |
| Áp dụng | Chỉ mục nội dung Artifact (L1/L2), Decision Record, Dossier; kết hợp lọc metadata và đồ thị liên kết (02 §9.3) |
| Quyết định liên quan | 02 C-07 |
| Hoãn | `asg017/sqlite-vec` (Apache-2.0, push 05/2026) nếu đo thấy tra cứu theo từ khóa thất bại thường xuyên. Orama (Apache-2.0) và MiniSearch (MIT) không cần vì đã có FTS5 trong DB |
| Rủi ro | FTS5 xử lý tiếng Việt có dấu/không dấu cần tokenizer phù hợp (ví dụ `unicode61 remove_diacritics`); cần thử với nội dung thật |
| **Đã thử 08/11/2026** | better-sqlite3 có SQLite 3.53.4 kèm FTS5. `unicode61 remove_diacritics 2` thô tìm được "thiet ke" → "thiết kế" nhưng **không** tìm được "dang nhap" → "đăng nhập" và "dac ta" → "đặc tả" (chữ `đ` không phân rã dấu). Thêm bước chuẩn hóa riêng (NFD bỏ dấu, đ→d) ở cả lúc lập chỉ mục và lúc truy vấn thì cả bốn truy vấn đạt. Không cần dependency mới. Chi tiết: 10-m3-slice-plan.md |

### O8 · Durable execution: giữ coordinator tự xây

| Mục | Nội dung |
|---|---|
| Khuyến nghị | Giữ coordinator SQLite theo V2 ADR-003 (outbox, claim, lease, epoch fencing, callback inbox) |
| Học thiết kế | `earendil-works/absurd` (Apache-2.0, chỉ cần Postgres, có SDK TypeScript), `dbos-inc/dbos-transact-ts` (MIT, workflow bền vững trên Postgres) |
| Lý do | Không có thư viện durable execution TypeScript trưởng thành nào chạy trên SQLite; các lựa chọn tốt đều cần Postgres hoặc máy chủ riêng |
| Xét lại khi | Control plane chuyển sang Postgres (ví dụ khi lên quy mô S3 nhiều người dùng, hoặc chọn P-B) thì Absurd, DBOS hoặc pg-boss trở thành ứng viên |

### O9 · xyflow (React Flow): Graph automation

`xyflow/xyflow` (MIT, push 06/11/2026). Đã có trong kế hoạch V2 F5-03; xác nhận vẫn phù hợp.

### O10 · OpenTelemetry: đo token và truy vết

| Mục | Nội dung |
|---|---|
| Khuyến nghị | Trace theo OpenTelemetry (Apache-2.0) và GenAI semantic conventions, cộng bảng usage tự quản trong DB |
| Quyết định liên quan | 02 §10.3 (chỉ số token, re-ask, pack hit rate) |
| Hoãn | `langfuse/langfuse` (core MIT, có phần enterprise): tự host cần Postgres, ClickHouse, Redis và S3, quá nặng cho quy mô cá nhân |

### O11 · Pack v2 và tool bên ngoài: khai báo năng lực, gắn MCP server (khảo sát 08/11/2026)

| Mục | Nội dung |
|---|---|
| Nhu cầu | Mục tiêu 'linh hoạt giữa các loại agent, dễ mở rộng': một đội mới (ví dụ marketing) cần khai báo **năng lực** của seat và **tool** được phép dùng (kể cả tool do MCP server bên ngoài cung cấp) ngay trong Pack, không sửa code lõi |
| Phương án A (đề xuất) | **Tự xây lớp khai báo mỏng, dùng định dạng mở có sẵn làm từ vựng**: manifest Pack v2 thêm `capabilities` cho seat (căn theo AgentSkill của A2A, OSS-06), `tools` (danh sách tool được phép theo tên, gồm tool Host và tool của MCP server được khai báo), `allowed-tools` trong SKILL.md theo chuẩn Agent Skills (trường **thử nghiệm**, mỗi client xử lý khác nhau, nên Host coi là gợi ý và vẫn tự kiểm theo `tools` của seat). Máy chủ MCP ngoài do **operator** đăng ký trong cấu hình Host (không phải Pack), Pack chỉ tham chiếu theo tên; Host là client MCP, chạy server trong sandbox hoặc qua proxy có allowlist, ghi vết mọi lần gọi |
| Phương án B | Đặt một **MCP gateway** mã nguồn mở giữa agent và các server: Docker MCP Gateway (MIT, bật/tắt từng tool theo profile), Bifrost (Apache-2.0, allowlist theo khóa ảo), Gate22 (aipotheosis-labs), SentinelGate, Enkrypt MCP Gateway, IBM ContextForge, MetaMCP. Lợi: có sẵn lọc tool, quản lý thông tin xác thực. Hại: thêm một dịch vụ phải chạy và bảo trì, một số giấy phép chưa xác nhận, nặng cho quy mô một operator; Host vẫn cần tự kiểm quyền theo seat |
| Phương án C | Chỉ dùng **MCP Registry** chính thức (`modelcontextprotocol/registry`, định dạng `server.json`) làm nguồn **tìm** server: là danh mục metadata ở trạng thái preview, không lưu mã, chưa đủ để thi hành quyền; dùng sau như nguồn nhập cấu hình |
| Thư viện client MCP | `@modelcontextprotocol/sdk` (đã duyệt ở OSS-03 cho phía server). Kết quả tìm kiếm cho thấy dòng v2 tách thành `@modelcontextprotocol/server` và `@modelcontextprotocol/client`, giấy phép ghi Apache-2.0 cho đóng góp mới và MIT cho mã cũ; **phải đối chiếu LICENSE và phiên bản ghim trước khi thêm dependency** |
| Quyết định liên quan | 01 §8.2 (Team Pack: Roles, Tool requirements, Policies), D-10 (taxonomy năng lực), OSS-02/03/05/06 |
| Rủi ro | Tool ngoài mở đường cho tiêm lệnh qua kết quả tool (coi mọi kết quả là dữ liệu, không phải chỉ thị), rò thông tin xác thực (secret chỉ ở Host, không vào prompt hay Pack), mở rộng bề mặt tấn công (cần allowlist, giới hạn tốc độ, timeout, ghi vết, bước duyệt khi đăng ký server) |
| Chưa kiểm chứng | Giấy phép và hành vi của MetaMCP, ContextForge, Gate22, SentinelGate; phiên bản MCP SDK v2 hiện hành; mức hỗ trợ `allowed-tools` của OpenCode |
| Đề xuất | **OSS-14**: chọn phương án A; B và C hoãn |

---

## 4. Chỉ học thiết kế

| Dự án | License · ngôn ngữ | Học điều gì | Vì sao không dùng trực tiếp |
|---|---|---|---|
| `gastownhall/beads` | MIT · Go | Truy vấn "việc sẵn sàng" theo đồ thị phụ thuộc; ID dạng hash chống va chạm khi nhiều agent/branch; nén task đã đóng ("memory decay"); lệnh `prime` nạp ngữ cảnh; `remember` cho tri thức dự án | Go + Dolt; trùng hệ Task của ta |
| `basicmachines-co/basic-memory` | AGPL-3.0 · Python | Markdown làm nguồn chuẩn, chỉ mục SQLite, truy cập qua MCP | AGPL, Python |
| `humanlayer/humanlayer` | Apache-2.0 · TypeScript | Daemon trên mỗi host chạy agent và đồng bộ phiên về một nơi (gần khái niệm Worker Node) | Đã chuyển sang kiến trúc cloud: Bun, AWS Lambda, Electric/Postgres |
| `paperclipai/paperclip` | MIT · TypeScript | Heartbeat có gộp, checkout lock, ngân sách theo nhiều cấp, Team Catalog, export/import bỏ secret, adapter Claude/Codex | Đã chọn tự xây (OSS-01). Tham khảo mã nguồn ở từng ticket tương ứng; mã gắn với Postgres nên chủ yếu học ý tưởng |
| Giao thức worker cũ trong repo (`/api/worker/claim`, `/heartbeat`, `/complete`) | Nội bộ · Python | Node chủ động nhận việc qua HTTPS outbound, lease, fencing theo generation, model proxy | Mã cũ, chỉ tham khảo giao thức |
| `EKINSOL-DEV/crewhub` | AGPL-3.0 · TypeScript | UX (đã dùng ở F0-02) | AGPL |

---

## 5. Loại hoặc hoãn

| Nhóm | Dự án | Kết luận và lý do |
|---|---|---|
| Framework multi-agent chạy trong tiến trình | `crewAIInc/crewAI`, `microsoft/agent-framework` (Python); `langchain-ai/langgraphjs`, `mastra-ai/mastra` (Apache-2.0 + phần `ee/`), `VoltAgent/voltagent`, `openai/openai-agents-js`, `kaiban-ai/KaibanJS` (TypeScript); `2FastLabs/agent-squad`; `ruvnet/ruflo` (trước là claude-flow); `OpenHands/OpenHands` | **Loại làm lõi.** Hệ thống điều phối các CLI agent (Claude, Codex, OpenCode) qua runtime riêng của chúng, không tự viết vòng lặp agent; framework trong tiến trình trùng vai trò Orchestrator. V2 D04 đã loại LangGraph |
| Máy chủ workflow riêng | Temporal, `hatchet-dev/hatchet`, `inngest/inngest` (license không phải OSS chuẩn), `triggerdotdev/trigger.dev`, `restatedev/restate` (BUSL) | **Loại** ở quy mô cá nhân: thêm server và DB riêng |
| Cần Redis/broker | `taskforcesh/bullmq` | **Loại**: trái nguyên tắc không bắt buộc broker |
| Hàng đợi trên Postgres | `timgit/pg-boss`, `graphile/worker` | **Hoãn**: chỉ xét nếu control plane chuyển sang Postgres |
| Nền tảng memory/RAG | `mem0ai/mem0`, `letta-ai/letta`, `getzep/graphiti`, `topoteretes/cognee`, `HKUDS/LightRAG` | **Hoãn**: mâu thuẫn 02 C-08 (không có bộ nhớ ẩn trong agent) và C-07 (chưa dùng vector) |
| Đã ngừng hoặc archived | `BloopAI/vibe-kanban` (README thông báo sunsetting), `coder/agentapi` (archived), `zed-industries/codex-acp` (archived) | **Loại** |
| Quản lý task cho agent | `eyaltoledano/claude-task-master` (license không phải SPDX chuẩn, push 04/2026) | **Loại**: trùng hệ Task, license chưa rõ |
| Lưu trữ phiên bản | Dolt, `isomorphic-git/isomorphic-git` | **Không cần**: Artifact lưu theo hash, code dùng Git CLI trên node |

---

## 6. Ảnh hưởng tới các quyết định đang chờ duyệt

| Quyết định | Ảnh hưởng |
|---|---|
| 01 D-01 (Hybrid Team Model) | Paperclip gần Persistent Team trong company; spike (S1, S10) cho biết có mở rộng được thành Hybrid không |
| 01 D-02 (mở rộng V2) | Đã duyệt: tự xây V2, không chạy thử Paperclip (OSS-01) |
| 01 D-03 (control plane + nhiều node) | Không có OSS thay thế phù hợp; tự xây, học từ worker cũ, Paperclip heartbeat, HumanLayer daemon |
| 01 D-06, 02 C-08 (tri thức có duyệt, không bộ nhớ ẩn) | Giữ nguyên; các nền tảng memory bị hoãn |
| 01 D-10 (taxonomy năng lực) | Căn theo AgentCard/AgentSkill của A2A (OSS-06) |
| 02 C-01 (giao tiếp qua Orchestrator) | Hiện thực bằng MCP server của Orchestrator (OSS-03) |
| 02 C-07 (truy xuất không vector) | SQLite FTS5 (OSS-07) |
| V2 F1-03, F3-02 (adapter) | ACP (OSS-02) gộp ba adapter thành một client + dự phòng native |
| V2 F1-04 (grant) | sandbox-runtime (OSS-04) |
| V2 ADR-003 (coordinator) | Giữ nguyên (OSS-08) |

---

## 6A. Giai đoạn 4 · Thực thi phân tán

Bổ sung 07/11/2026 cho [03 · Distributed Worker](03-distributed-worker.md). License kiểm qua file LICENSE/COPYING gốc trên GitHub; mức hoạt động ở §7A.

### Áp dụng

| ID | Dự án | License | Dùng cho | Quyết định liên quan |
|---|---|---|---|---|
| OSS-09 | `benbjohnson/litestream` | Apache-2.0 | Sao lưu liên tục SQLite của control plane sang NAS hoặc máy khác; khôi phục nhanh khi VM hỏng | E-13. **Chưa xác minh** NAS hỗ trợ đích nào (thư mục, SFTP, tương thích S3) |
| OSS-10 | `winsw/winsw` | MIT | Chạy node agent Windows như một Windows service (tự khởi động cùng máy, khởi động lại khi lỗi) | E-12 |

### Giữ hạ tầng hiện có

| Dự án | License | Ghi chú |
|---|---|---|
| `netbirdio/netbird` | BSD-3-Clause; các thư mục `management/`, `signal/`, `relay/`, `combined/` theo license khác (AGPL) | Đang dùng cho subnet routing; không thay bằng Tailscale. Chỉ dùng làm đường mạng, không thay xác thực của ứng dụng |
| Docker (trên `.60`) | Apache-2.0 | Sandbox container đã kiểm ở bootstrap `.60` |
| `containers/bubblewrap` | LGPL-2.0+ (`COPYING`) | Dùng gián tiếp qua `sandbox-runtime` (OSS-04) |

### Học thiết kế

| Dự án | License | Học điều gì |
|---|---|---|
| `buildkite/agent` | MIT | Agent chủ động kết nối ra, đăng ký bằng token, nhận job, heartbeat, hủy job |
| GitLab Runner (`gitlabhq/gitlab-runner`, mirror) | MIT | Đăng ký runner bằng token phạm vi project, `concurrent`, executor cô lập; đã chạy thật trên `.60` |
| Giao thức worker Python cũ trong repo | Nội bộ | `claim/heartbeat/complete`, token lưu hash, generation, worker trả thay đổi để control plane commit |

### Hoãn

| Dự án | License | Lý do hoãn |
|---|---|---|
| `smallstep/certificates` (step-ca) | Apache-2.0 | mTLS cho node khi mở rộng; MVP dùng TLS qua CA Caddy + credential node |
| `openbao/openbao` | MPL-2.0 | Secret broker riêng khi nhiều node/người dùng; MVP dùng credential store mã hóa trong control plane |
| `getsops/sops` | MPL-2.0 | Mã hóa file cấu hình khi cần lưu secret trong Git |
| `podman-container-tools/podman` (trước là `containers/podman`) | Apache-2.0 | Container rootless; giữ Docker đã kiểm chứng ở MVP |
| `superfly/litefs` | Apache-2.0 | Nhân bản SQLite cho độ sẵn sàng cao; chưa cần ở quy mô cá nhân |
| `e2b-dev/E2B` | Apache-2.0 | Sandbox trên cloud; trái hướng local-first ở MVP |
| `Comfy-Org/ComfyUI` (trước là `comfyanonymous/ComfyUI`) | GPL-3.0 | Công cụ tạo ảnh/video trên GPU node; chỉ chạy như tiến trình riêng qua API, không nhúng mã; chờ có GPU |

### Loại

| Dự án | License | Lý do |
|---|---|---|
| `nats-io/nats-server` | Apache-2.0 | Message broker; trái nguyên tắc không bắt buộc broker |
| `hashicorp/nomad` | BUSL-1.1 | License không phải OSS chuẩn; quá nặng cho quy mô cá nhân |
| `k3s-io/k3s` | Apache-2.0 | Kubernetes quá nặng cho 2–3 node cá nhân |
| `coder/coder` | AGPL-3.0 | License AGPL; là nền tảng workspace riêng, trùng vai trò |

---

## 6B. Giai đoạn 5 · Workflow, lịch, thông báo

Chi tiết: [04 §22](04-workflow-and-governance.md). Dữ liệu GitHub API 07/11/2026.

| Dự án | License | Hoạt động | Kết luận |
|---|---|---|---|
| `Hexagon/croner` | MIT, TypeScript | push 04/11/2026 | **Áp dụng** (OSS-11): cron + múi giờ IANA |
| `connor4312/cockatiel` | MIT, TypeScript | push 29/10/2026 | **Áp dụng** (OSS-11): retry, circuit breaker, timeout |
| `dagrejs/dagre` | MIT, TypeScript | push 24/10/2026 | Tùy chọn: bố cục đồ thị Workflow |
| `binwiederhier/ntfy` | Apache-2.0, Go | push 04/11/2026 | Tùy chọn: push tự host |
| `caronc/apprise` | BSD-2-Clause, Python | push 05/11/2026 | Thay thế nhiều kênh |
| `open-workflow-specification/specification` | Apache-2.0 | push 05/11/2026 | Học thiết kế DSL |
| `statelyai/xstate` | MIT | push 06/11/2026 | Học; chỉ xét cho UI |
| `CacheControl/json-rules-engine` | ISC | push 16/02/2026 | Học |
| `harrisiirak/cron-parser`, `nodeshift/opossum`, `gotify/server` | MIT / Apache-2.0 / chưa nhận diện | đang hoạt động | Thay thế |
| `n8n-io/n8n`, `windmill-labs/windmill`, `activepieces/activepieces`, `kestra-io/kestra`, `bpmn-io/bpmn-js`, `kieler/elkjs`, `jwadhams/json-logic-js`, `jkbrzt/rrule` | Nhiều loại | — | Loại (lý do ở 04 §22.5) |

## 6C. Giai đoạn 6 · Stack kiến trúc mục tiêu

Chi tiết: [05 §9, §11, §19](05-target-architecture.md). Dữ liệu GitHub API 07/11/2026.

| Dự án | License | Hoạt động | Kết luận |
|---|---|---|---|
| `fastify/fastify` | MIT | push 06/11/2026 | **Áp dụng** (OSS-12): HTTP server |
| `honojs/hono` | MIT | push 05/11/2026 | Thay thế |
| `WiseLibs/better-sqlite3` | MIT | push 10/08/2026 | **Áp dụng** (OSS-12), V1 đã dùng |
| `kysely-org/kysely` | MIT | push 06/11/2026 | **Áp dụng** (OSS-12): truy cập DB, giữ đường sang Postgres |
| `drizzle-team/drizzle-orm` | Apache-2.0 | push 06/11/2026 | Thay thế |
| `pinojs/pino` | MIT | push 06/10/2026 | **Áp dụng** (OSS-12) |
| `open-telemetry/opentelemetry-js` | Apache-2.0 | push 06/11/2026 | **Áp dụng** (OSS-12) |
| `vercel/ai` | Chưa nhận diện license | push 06/11/2026 | Tùy chọn cho API agent, cần kiểm license |
| `seaweedfs/seaweedfs` | Apache-2.0 | push 06/11/2026 | Dành cho khi cần S3 |
| `minio/minio` | AGPL-3.0 | **Archived** (push cuối 24/04/2026) | **Loại** |
| `microsoft/autogen` | Code MIT, tài liệu CC-BY-4.0 | **Đang chuyển sang archived** | **Loại** |
| `langchain-ai/langgraph`, `temporalio/temporal` | MIT | đang hoạt động | Loại làm lõi; học thiết kế |
| VMware Workstation 25.0.1 (đã cài trên laptop) | Phần mềm thương mại, không phải OSS | — | Dùng cho máy ảo phát triển (05 §21) |

## 6D. Giai đoạn 7 · Công cụ kiểm thử cho roadmap

Chi tiết: [06 §8, §13](06-implementation-roadmap.md). GitHub API 07/11/2026.

| Dự án | License | Hoạt động | Kết luận |
|---|---|---|---|
| `microsoft/playwright` | Apache-2.0 | push 06/11/2026 | **Đề xuất áp dụng** (OSS-13): E2E UI; hệ Python cũ đã dùng |
| `dubzzz/fast-check` | MIT | push 06/11/2026 | **Đề xuất áp dụng** (OSS-13): property test state machine |

---

## 7. Dữ liệu 52 repo (GitHub API, 07/11/2026)

Số sao làm tròn để tham khảo, không phải tiêu chí chính. "NOASSERTION" nghĩa là GitHub không nhận diện được một license SPDX duy nhất.

| Repo | License | Ngôn ngữ | Sao | Push gần nhất | Ghi chú | Kết luận |
|---|---|---|---|---|---|---|
| paperclipai/paperclip | MIT | TypeScript | ~112k | 2026-11-06 | | Học thiết kế, tham khảo mã (§2) |
| EKINSOL-DEV/crewhub | AGPL-3.0 | TypeScript | 29 | 2026-06-12 | | Học UX |
| crewAIInc/crewAI | MIT | Python | ~61k | 2026-11-06 | | Loại |
| microsoft/agent-framework | MIT | Python | ~15k | 2026-11-06 | | Loại |
| langchain-ai/langgraphjs | MIT | TypeScript | ~3,4k | 2026-11-06 | | Loại |
| mastra-ai/mastra | NOASSERTION (Apache-2.0 + `ee/`) | TypeScript | ~29k | 2026-11-06 | | Loại |
| VoltAgent/voltagent | MIT | TypeScript | ~11k | 2026-11-06 | | Loại |
| kaiban-ai/KaibanJS | MIT | TypeScript | ~1,5k | 2026-05-15 | | Loại |
| 2FastLabs/agent-squad | Apache-2.0 | Python | ~7,8k | 2026-10-08 | Đổi từ awslabs | Loại |
| ruvnet/ruflo | MIT | TypeScript | ~81k | 2026-11-06 | Trước là claude-flow | Loại |
| openai/openai-agents-js | MIT | TypeScript | ~4k | 2026-11-06 | | Loại |
| BloopAI/vibe-kanban | Apache-2.0 | Rust | ~29k | 2026-11-04 | Sunsetting | Loại |
| OpenHands/OpenHands | MIT | TypeScript | ~93k | 2026-11-06 | | Loại |
| bmad-code-org/BMAD-METHOD | NOASSERTION (README: MIT + nhãn hiệu) | Python | ~55k | 2026-11-06 | | Áp dụng nội dung (O5) |
| github/spec-kit | MIT | Python | ~148k | 2026-11-06 | | Áp dụng nội dung (O5) |
| gastownhall/beads | MIT | Go | ~29k | 2026-11-06 | Đổi từ steveyegge | Học |
| humanlayer/humanlayer | Apache-2.0 | TypeScript | ~13k | 2026-11-05 | Đã chuyển hướng | Học |
| coder/agentapi | MIT | Go | ~1,5k | 2026-09-13 | Archived | Loại |
| a2aproject/A2A | Apache-2.0 | Shell (spec) | ~26k | 2026-11-05 | | Áp dụng chuẩn tên (O6) |
| a2aproject/a2a-js | Apache-2.0 | TypeScript | 649 | 2026-11-05 | | Hoãn |
| modelcontextprotocol/typescript-sdk | NOASSERTION (MIT → Apache-2.0) | TypeScript | ~14k | 2026-11-05 | | Áp dụng (O2) |
| agentclientprotocol/agent-client-protocol | Apache-2.0 | Rust (schema) | ~4,6k | 2026-11-06 | | Áp dụng (O1) |
| agentclientprotocol/claude-agent-acp | Apache-2.0 | TypeScript | ~2,7k | 2026-11-06 | Bọc SDK không phải OSS | Áp dụng (O1) |
| zed-industries/codex-acp | NOASSERTION | Rust | 872 | 2026-07-22 | Archived | Loại (dùng bản mới) |
| anomalyco/opencode | MIT | TypeScript | ~225k | 2026-11-06 | Trước là sst/opencode; có `opencode acp` | Runtime hiện tại |
| openai/codex | Apache-2.0 | Rust | ~133k | 2026-11-06 | | Runtime |
| anthropics/claude-agent-sdk-typescript | Không có | — | ~1,9k | 2026-11-06 | Điều khoản Anthropic | Runtime (không phải OSS) |
| anthropics/skills | Không có license chung | Python | ~188k | 2026-10-28 | License theo từng skill | Nguồn skill, kiểm từng mục |
| anthropics/sandbox-runtime | Apache-2.0 | TypeScript | ~7k | 2026-11-06 | Beta | Áp dụng (O3) |
| temporalio/sdk-typescript | MIT | TypeScript | 946 | 2026-11-06 | Cần Temporal server | Loại |
| hatchet-dev/hatchet | MIT | Go | ~8,2k | 2026-11-06 | | Loại |
| inngest/inngest | NOASSERTION | Go | ~6k | 2026-11-06 | | Loại |
| triggerdotdev/trigger.dev | Apache-2.0 | TypeScript | ~17k | 2026-11-03 | | Loại |
| restatedev/restate | NOASSERTION (BUSL) | Rust | ~4,7k | 2026-11-06 | | Loại |
| dbos-inc/dbos-transact-ts | MIT | TypeScript | ~1,4k | 2026-11-04 | Cần Postgres | Học |
| timgit/pg-boss | MIT | TypeScript | ~4,1k | 2026-11-06 | Cần Postgres | Hoãn |
| graphile/worker | MIT | TypeScript | ~2,4k | 2026-11-05 | Cần Postgres | Hoãn |
| taskforcesh/bullmq | MIT | TypeScript | ~9,6k | 2026-11-06 | Cần Redis | Loại |
| earendil-works/absurd | Apache-2.0 | Python (+ SDK TS) | ~2,5k | 2026-11-05 | Cần Postgres | Học |
| letta-ai/letta | Apache-2.0 | — | ~25k | 2026-10-18 | | Hoãn |
| mem0ai/mem0 | Apache-2.0 | Python | ~69k | 2026-11-06 | | Hoãn |
| getzep/graphiti | Apache-2.0 | Python | ~33k | 2026-11-06 | | Hoãn |
| topoteretes/cognee | Apache-2.0 | Python | ~33k | 2026-11-06 | | Hoãn |
| basicmachines-co/basic-memory | AGPL-3.0 | Python | ~4,5k | 2026-11-06 | | Học |
| HKUDS/LightRAG | MIT | Python | ~41k | 2026-11-05 | | Hoãn |
| oramasearch/orama | NOASSERTION (LICENSE: Apache-2.0) | TypeScript | ~11k | 2026-10-18 | | Không cần |
| lucaong/minisearch | MIT | TypeScript | ~6,2k | 2025-09-16 | Ít cập nhật | Không cần |
| asg017/sqlite-vec | Apache-2.0 | C | ~8,2k | 2026-05-18 | | Hoãn |
| xyflow/xyflow | MIT | TypeScript | ~39k | 2026-11-06 | | Áp dụng (O9) |
| langfuse/langfuse | NOASSERTION (MIT + `ee`) | TypeScript | ~37k | 2026-11-06 | Tự host nặng | Hoãn |
| isomorphic-git/isomorphic-git | MIT | JavaScript | ~8,4k | 2026-11-05 | | Không cần |
| eyaltoledano/claude-task-master | NOASSERTION | JavaScript | ~28k | 2026-04-28 | | Loại |

### 7A. Dữ liệu bổ sung (GitHub API, 07/11/2026, giai đoạn 4 và 4 repo còn thiếu)

| Repo | License | Ngôn ngữ | Sao | Push gần nhất | Ghi chú | Kết luận |
|---|---|---|---|---|---|---|
| benbjohnson/litestream | Apache-2.0 | Go | ~14,6k | 2026-11-03 | | Áp dụng (OSS-09) |
| winsw/winsw | MIT | C# | ~14,4k | 2026-07-30 | | Áp dụng (OSS-10) |
| netbirdio/netbird | NOASSERTION (BSD-3 + phần AGPL) | Go | ~31k | 2026-11-06 | Đang dùng | Giữ hạ tầng |
| podman-container-tools/podman | Apache-2.0 | Go | ~33k | 2026-11-06 | Đổi từ containers/podman | Hoãn |
| containers/bubblewrap | NOASSERTION (LGPL-2.0+ theo COPYING) | C | ~9,4k | 2026-10-14 | | Dùng gián tiếp |
| smallstep/certificates | Apache-2.0 | Go | ~9k | 2026-11-06 | | Hoãn |
| openbao/openbao | MPL-2.0 | Go | ~8,9k | 2026-11-06 | | Hoãn |
| getsops/sops | MPL-2.0 | Go | ~23,6k | 2026-11-03 | | Hoãn |
| buildkite/agent | MIT | Go | ~1,1k | 2026-11-06 | | Học thiết kế |
| gitlabhq/gitlab-runner | MIT | Go | 248 | 2026-09-02 | Mirror; nguồn chính trên GitLab.com | Học thiết kế |
| nats-io/nats-server | Apache-2.0 | Go | ~21k | 2026-11-06 | | Loại |
| e2b-dev/E2B | Apache-2.0 | Python | ~14,7k | 2026-11-06 | | Hoãn |
| coder/coder | AGPL-3.0 | Go | ~17,3k | 2026-11-06 | | Loại |
| Comfy-Org/ComfyUI | GPL-3.0 | Python | ~145k | 2026-11-06 | Đổi từ comfyanonymous | Hoãn |
| superfly/litefs | Apache-2.0 | Go | ~4,9k | 2026-10-30 | | Hoãn |
| hashicorp/nomad | NOASSERTION (BUSL-1.1) | Go | ~17k | 2026-11-05 | | Loại |
| k3s-io/k3s | Apache-2.0 | Go | ~34k | 2026-11-06 | | Loại |
| gastownhall/gastown | MIT | Go | ~18,7k | 2026-10-28 | Trình quản lý workspace đa agent, cùng tác giả với beads | Học thiết kế (chưa đọc README) |
| agentclientprotocol/codex-acp | NOASSERTION (Apache-2.0 theo LICENSE và package.json) | TypeScript | 553 | 2026-11-06 | Thay bản archived của Zed | Áp dụng cùng OSS-02 |
| agentclientprotocol/typescript-sdk | Apache-2.0 | TypeScript | 270 | 2026-11-02 | SDK client/agent ACP | Áp dụng cùng OSS-02 |
| agentskills/agentskills | Apache-2.0 | Python | ~27k | 2026-11-04 | Spec Agent Skills | Áp dụng cùng OSS-05 |

---

## 8. Chưa kiểm chứng

| Mục | Lý do | Cách kiểm |
|---|---|---|
| ~~Metadata 4 repo còn thiếu~~ | Đã tra xong 07/11/2026, xem §7A | — |
| Nội dung README của `gastownhall/gastown` | Mới có metadata | Đọc khi cần tham khảo quản lý workspace đa agent |
| Mọi tính năng Paperclip ở §2 | Chỉ đọc README và docs, chưa chạy; người dùng chọn không chạy thử | Đọc mã nguồn khi tham khảo từng phần; chạy thử nếu tới mốc xét lại của D-02 |
| ACP đủ năng lực cho resume/stop/permission của từng runtime | Chưa thử ACP client với OpenCode/Claude/Codex | Thử trong F1-03 |
| sandbox-runtime chạy được trong WSL2 (bubblewrap, user namespace) | Chưa thử | Thử trên `/home/lazy/factory-v2` |
| FTS5 xử lý tốt tiếng Việt có dấu/không dấu | Chưa thử với dữ liệu thật | Thử với tài liệu Research mẫu |
| Chi tiết trường frontmatter của Agent Skills spec | Thông tin chi tiết lấy từ bản sao bên thứ ba | Đối chiếu agentskills.io/specification |
| Ngày phát hành A2A v1.0 | Các nguồn thứ cấp ghi khác nhau | Đối chiếu release chính thức (không ảnh hưởng quyết định) |

---

## 9. Lịch sử cập nhật

| Ngày | Giai đoạn | Thay đổi |
|---|---|---|
| 07/11/2026 | Giai đoạn 1–3 (khảo sát, domain model, cộng tác và tri thức) | Bản đầu: 52 repo, 8 quyết định OSS-01..08 |
| 07/11/2026 | Quyết định | Người dùng chọn tự xây Factory V2, không chạy thử Paperclip: OSS-01 và OSS-08 Đã duyệt |
| 07/11/2026 | Giai đoạn 4 (thực thi phân tán) | Thêm §6A, §7A: 21 repo; OSS-09 Litestream, OSS-10 WinSW; bổ sung metadata 4 repo còn thiếu |
| 07/11/2026 | Quyết định | Người dùng chốt phương án giai đoạn 4: OSS-09, OSS-10 Đã duyệt |
| 07/11/2026 | Đồng bộ giai đoạn 5–6 | Thêm §6B, §6C; OSS-11 (croner, cockatiel), OSS-12 (Fastify, better-sqlite3, Kysely, pino, OpenTelemetry) Đã duyệt |
| 08/11/2026 | Mở rộng Pack (M3+) | Thêm §3 O11: khảo sát gateway MCP, MCP Registry, `allowed-tools`; OSS-14 đã duyệt (phương án A) |

---

## 10. Nguồn

**Nguồn gốc:**
- GitHub REST API `https://api.github.com/repos/{owner}/{repo}` cho 52 repo ở §7 (07/11/2026)
- README: [paperclipai/paperclip](https://github.com/paperclipai/paperclip), [agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol), [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime), [gastownhall/beads](https://github.com/gastownhall/beads), [dbos-inc/dbos-transact-ts](https://github.com/dbos-inc/dbos-transact-ts), [earendil-works/absurd](https://github.com/earendil-works/absurd), [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban), [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer), [a2aproject/A2A](https://github.com/a2aproject/A2A), [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- Spec: [A2A `specification/a2a.proto`](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto); [danh sách agent ACP](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/get-started/agents.mdx); [OpenCode ACP](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/acp.mdx)
- Docs Paperclip: [Team Catalog](https://docs.paperclip.ing/guides/org/team-catalog/), [Deployment Modes](https://docs.paperclip.ing/reference/deploy/deployment-modes/), [Adapters Overview](https://docs.paperclip.ing/reference/adapters/overview/), [Org Structure](https://docs.paperclip.ing/guides/org/org-structure/)
- LICENSE: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE), [Orama](https://github.com/oramasearch/orama/blob/main/LICENSE.md), [Mastra](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)

**Nguồn thứ cấp (chỉ định hướng):**
- [dev.to: Agent Client Protocol](https://dev.to/dmaxdev/agent-client-protocol-acp-connect-any-ai-agent-to-any-editor-2p0m)
- [aaif.io: A2A v1.0 builder's guide](https://aaif.io/blog/a2a-v1-0-a-builder-s-guide-part-1-discovery-tasks-and-clients)
- [agentskills.io](https://agentskills.io/)
