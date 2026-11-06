# 07 · Architecture Review độc lập

| Mục | Giá trị |
|---|---|
| Vai trò | Principal Architect độc lập, phản biện toàn bộ `docs/architecture/` (00–06, oss-options) |
| Ngày | 07/11/2026 |
| Baseline | commit `692ad3f`, branch `architecture/multi-team-research` |
| Nguyên tắc | Không coi thiết kế trước là đúng vì đã được đề xuất hoặc duyệt; chỉ **đề xuất** thay đổi, không sửa các tài liệu khác |
| Thang mức độ | **Critical**: phải xử lý trước khi dùng thật · **High**: phải quyết định trước milestone liên quan · **Medium**: nên xử lý, có thể lùi · **Low**: cải thiện |

---

## 1. Tóm tắt điều hành

**Điểm mạnh thật sự:**
- Ranh giới cốt lõi đúng và nhất quán: một control plane xác định, node chủ động nhận việc, lease/epoch fencing, side effect tập trung, Session ngắn, trạng thái nằm trong dữ liệu. Đây là những quyết định khó đổi và đã được chọn đúng, có tiền lệ chạy thật (hệ Python cũ trên `.14`/`.60`, V1).
- Bảo vệ V1 rõ ràng (strangler, V1 Protection Guard, không chia sẻ DB).
- Không thêm hạ tầng không cần (không Postgres/Redis/broker/Temporal ở MVP), có điều kiện nâng cấp rõ.

**Điểm yếu chính:**
1. **Mô hình khái niệm quá lớn so với một người vận hành và phát triển.** Khoảng 30 thực thể, 6 state machine, 8 loại Approval, 13 abstraction thay công nghệ, 5 mức tự chủ, circuit breaker ở 6 phạm vi. Phần lớn đúng cho dài hạn nhưng **chưa cần ở MVP**, và M0 đang định chốt gần hết ngay từ đầu.
2. **Bậc C0 (MVP) chạy code agent cùng user hệ điều hành với control plane**: agent có Bash đọc được DB, kho tri thức của mọi Project và key 9Router. Điều này trái nguyên tắc P2/E-11 đã duyệt và mở rộng rủi ro so với V1 vì giờ nhiều Project dùng chung một kho. **Critical.**
3. **Một số cơ chế an toàn đã duyệt rơi vào milestone muộn hơn chức năng tạo ra rủi ro**: CTR có ở M3 nhưng ngân sách/circuit breaker ở M5; đẩy branch ra ngoài có từ M2 nhưng Effect Executor ở M4; sandbox ở M6; sao lưu liên tục ở M6 trong khi dùng hằng ngày từ M2.
4. **Tài liệu chưa đồng bộ với các sửa đổi đã duyệt** (01 vẫn dùng "Workflow Run", 02 vẫn có Task state `Waiting/InProgress/Interrupted` dù ADR-T04 đã thay).

**Kết luận sơ bộ:** đủ điều kiện bắt đầu **R0 và một M0 thu gọn** ngay; **chưa đủ** để bắt đầu M1/M2 cho tới khi duyệt các điều chỉnh ở §5 (đặc biệt AR-C1, AR-H1..H6). Chi tiết ở §10.

---

## 2. Kiểm tra theo 14 nhiệm vụ

### 2.1 Nhất quán giữa Domain, Task, Worker, Workflow Model

| Kiểm tra | Kết quả | Mức |
|---|---|---|
| Thuật ngữ Workflow | 01 §3, §4.2 vẫn dùng **Workflow Run**; 04/05 dùng Workflow Instance (I1 đã phát hiện ở 05 nhưng chưa sửa 01) | Low |
| Task lifecycle | 02 §5.1 vẫn có `Queued/InProgress/Waiting/Interrupted/Paused`; ADR-T04 (05 §8.2) đã đổi sang `Active` + holds + disposition nhưng 02 chưa cập nhật. Người hiện thực đọc 02 sẽ làm sai | **Medium** |
| CTR và Task | CTR có state machine riêng 13 trạng thái (02 §5.3), song song Task; `produce`/`review` lại sinh Task con. Hai thực thể cùng mô tả "một việc được yêu cầu" | **Medium** (§3, AR-M1) |
| Approval, Decision, Review | 05 I5 đã gộp về Approval; 02 §14 và V2 `decisionSchema` chưa đổi | Low |
| Worker/Attempt | 03 §12.2 ánh xạ được sang V2 `runStateSchema`; nhất quán | OK |
| Execution Gate | C-04 (đã duyệt) cần cổng trước Execution, nhưng gate được hiện thực trong `workflow` ở **M5**; MVP M2 không có Workflow → C-04 không có chỗ đặt trong MVP | **Medium** (AR-M5) |
| Lộ trình | 00 §3C ghi "M0–M6 thay F1-02..F9" (đã duyệt); 06 đổi thứ tự (RM-01, chưa duyệt). Hai thứ tự cùng tồn tại | Low (chờ quyết định) |

### 2.2 Thiết kế quá phức tạp so với nhu cầu

| Thành phần | Vấn đề | Đề xuất |
|---|---|---|
| **Phạm vi M0** | Định chốt gần như mọi thực thể (Workflow, Standing Approval, Budget nhiều cấp, Effect, Pack...) trước khi có một Task chạy | M0 chỉ chốt phần M1–M2 cần + điểm mở rộng (AR-H1) |
| Approval 8 loại + TTL/nhắc/leo thang/ủy quyền + Standing Approval | MVP chỉ cần: câu hỏi nghiệp vụ, nghiệm thu, xác nhận bắt đầu | Hai loại ở MVP; phần còn lại M5 |
| CTR 6 loại × 13 trạng thái | Phức tạp hơn nhu cầu "Team A nhờ Team B" | Hợp nhất vào Task (AR-M1) |
| Mức tự chủ L0–L4 | Hiện thực đúng cần policy engine; MVP chỉ có một Operator | MVP: hai mức (tự làm trong Task / hỏi Operator) |
| Circuit breaker 6 phạm vi | Có giá trị khi chạy tự động 24/7; MVP chưa có lịch | MVP: chỉ ngân sách theo Task và theo ngày |
| Workflow Pack có `allowedPatches`, `joins quorum`, `wait-until` | Đúng cho M5; không ảnh hưởng MVP | Giữ ở M5, không đưa vào M0 |
| Pack Registry có hash/license/import-export | Cho người dùng cá nhân, Pack là thư mục trong repo | MVP: đọc `packs/*` lúc khởi động, có `version` |
| Hai runtime adapter ở M2 (ACP + native) | Gấp đôi công việc và test | M2 chỉ dùng một (AR-H5) |

### 2.3 Abstraction chưa cần thiết

05 §7.4 liệt kê 13 abstraction. Đề xuất phân loại lại:

| Giữ ngay (có ≥2 hiện thực trong ≤2 milestone) | Hoãn (chỉ một hiện thực trong tương lai gần) |
|---|---|
| `RuntimeAdapter` (fake, OpenCode, API agent) | `QueueLease`, `EventBus`, `AuthProvider`, `SecretStore`, `SearchIndex`, `NotificationChannel` |
| `SandboxProvider` (không sandbox/sandbox Linux; Windows ở M4) | `BlobStore` (chỉ cần hàm đọc/ghi theo hash trong `knowledge`) |
| `ModelGateway` (proxy thật, fake) | `NodeTransport` (đến M4 mới có hiện thực thứ hai) |
| `Clock` (test lịch, lease) | |
| Repository qua Kysely (chi phí thấp, giữ đường sang Postgres) | |

Nguyên tắc: abstraction được tạo **khi xuất hiện hiện thực thứ hai**, trừ khi chi phí đổi sau rất cao. Ranh giới module (05 §6) vẫn giữ; chỉ không tạo interface thay thế công nghệ quá sớm. **Medium** (AR-M3).

### 2.4 Coupling giữa Team, Agent, Worker, Project

| Cặp | Đánh giá |
|---|---|
| Team ↔ Project | Tách bằng Engagement: đúng. Rủi ro: Engagement mang quá nhiều thứ (ưu tiên, hạn mức, grant, thời hạn). MVP chỉ cần liên kết + ưu tiên |
| Team ↔ Agent | Seat → Profile revision: đúng, không gắn máy |
| Agent ↔ Worker | Instance gắn node; Session không di chuyển: đúng. **Instance** là lớp trung gian giữa Seat và slot node chưa có hành vi riêng ở MVP → có thể ngầm định (slot) (AR-M2) |
| Project ↔ Worker | Lớp vị trí `node-bound` gắn Task với máy qua capability: đúng. Rủi ro coupling ẩn: thư mục dự án trên Windows (06 §5.3) |
| Team Lead ↔ Project Lead | D-04 gộp khi một Team: đúng, giảm tầng |
| **API agent ↔ workspace** | Lead chạy bằng API agent (ADR-T06) **không có quyền đọc repo**; tool MCP của control plane không có workspace (workspace ở node). Lead lập kế hoạch code mà không đọc được code → chất lượng kém hơn V1 (Lead V1 là phiên OpenCode chỉ đọc) | **High** (AR-H6) |

### 2.5 Tái sử dụng Team giữa nhiều Project

Thiết kế đáp ứng: Team bền vững, Engagement, Session theo Project, tri thức Team qua promotion có duyệt (D-06), Artifact chia sẻ pinned (D-08). **Thiếu:** cách phân bổ slot khi một Team phục vụ nhiều Project chưa có giá trị mặc định (hạn mức mỗi Engagement); triage của Team Lead tốn một phiên LLM cho mỗi yêu cầu. Mức **Low–Medium**; xem tình huống S1.

### 2.6 Giao việc giữa Team: vòng lặp, mất Task

- Vòng lặp: hop ≤3, thread ≤3, sửa ≤3/issue, ngân sách theo chuỗi gốc (C-10). Thiết kế đủ, **nhưng hiện thực rơi vào M5 trong khi CTR có từ M3** → cửa sổ M3–M4 không có trần chi phí theo chuỗi. **High** (AR-H3).
- Mất Task: CTR là bản ghi bền vững có idempotency; CTR hết hạn thì Task nguồn chuyển Blocked có lý do. **Khoảng trống:** khi control plane không truy cập được, lời gọi MCP `request.create` thất bại; agent có thể "tưởng" đã gửi và báo hoàn thành. Cần quy tắc: lỗi tool là lỗi của Task, không phải thông tin để agent tự xử lý. **Medium** (AR-M6).

### 2.7 Phục hồi khi mất kết nối, worker offline

Thiết kế mạnh (03 §15 K1–K8). **Khoảng trống mới phát hiện:** khi **VM VMware bị tạm dừng (suspend)**, đồng hồ đơn điệu trong VM dừng; khi chạy tiếp, node tin lease còn hạn trong khi control plane đã cấp lại cho node khác. Side effect bên ngoài vẫn an toàn (Effect Executor kiểm epoch) nhưng node có thể tiếp tục tốn token cho tới lần gia hạn kế tiếp. Cần quy định: sau bất kỳ lần gia hạn thất bại hoặc bị từ chối, node dừng ngay; node so sánh cả đồng hồ thực, không chỉ đồng hồ đơn điệu. **Medium** (AR-M7).

### 2.8 Bền vững của Knowledge và Artifact

Thiết kế dữ liệu tốt (version bất biến, hash, provenance). **Vấn đề vận hành:** từ M2 người dùng làm việc hằng ngày nhưng **sao lưu liên tục (Litestream) đến M6**; MVP chỉ backup trước migration. DB và kho file nằm trong ổ ảo của WSL trên C:; hỏng distro WSL là mất toàn bộ. **High** (AR-H4).

### 2.9 Quyền truy cập, rò rỉ giữa Project, rủi ro từ Tool

- **Critical (AR-C1):** ở C0/MVP, Host, kho tri thức, key 9Router và tiến trình agent chạy **cùng user Linux trong WSL**. V1 cho agent đọc mọi file trừ danh sách chặn (`runtime/permissions.ts`: `"*": "allow"` + deny `.env`, `*.pem`...) và cho Bash với role dev. Bash đọc được `~/.local/state/factory-v2/*.sqlite` (mọi Project) và cấu hình chứa key. Kiểm quyền ở tool MCP (02 §16) trở nên vô nghĩa nếu agent đọc thẳng DB. Rủi ro lớn hơn V1 vì V2 gom nhiều Project và tri thức vào một kho.
- Prompt injection qua tri thức của Team khác: được giảm vì quyền do phần xác định áp (02 §16); chấp nhận được.
- Tool nguy hiểm: Effect Executor, Approval cho hành động không đảo ngược; nhưng sandbox ở M6 và node Windows yếu (E-11). Liên quan AR-C1.

### 2.10 Migration có làm hỏng chức năng hiện tại không

Không: V1 không bị sửa, có Guard, DB tách, chạy song song có quy tắc (06 §6). **Khoảng trống nhỏ:** nếu V1 cần sửa lỗi nghiêm trọng trong thời gian chuyển, Guard sẽ chặn; cần quy trình ngoại lệ (cập nhật baseline có duyệt). **Low** (AR-L3). Rủi ro thật nằm ở việc người dùng chuyển công việc sang V2 khi V2 chưa có sao lưu (AR-H4).

### 2.11 Vận hành trên một máy Windows và một Home Server

| Cấu hình | Đánh giá |
|---|---|
| Chỉ laptop (VMware) — đã chốt cho giai đoạn phát triển | Khả thi; không có 24/7; RAM khoảng 25–28/31,7 GB khi chạy đủ (05 §21) |
| Laptop + Home Server (`.14`/Proxmox) — mốc M2b | Khả thi, control plane nhẹ; cần TLS/xác thực khi mở ra LAN (đã có Caddy, CA). **Khoảng trống:** quy trình chuyển DB từ WSL/VM laptop sang server chưa viết (export/import, đổi địa chỉ node, đổi credential) → **Low** (AR-L4) |
| Node Windows chạy bằng WinSW | **Khoảng trống:** nếu service chạy bằng tài khoản hệ thống, nó không thấy đăng nhập Codex/Claude trong profile của người dùng; phải chạy bằng tài khoản người dùng. Chưa ghi trong 03/05 → **Medium** (AR-M8) |

### 2.12 Chi phí vận hành, token, độ phức tạp khi mở rộng

- Token: mỗi lớp mới đều thêm lượt LLM: Lead (Project), Team Lead triage cho mỗi CTR, tóm lược L1 cho mỗi Artifact, Resume Briefing, Reporting. Chưa có số đo cơ sở. Nguy cơ chi phí gấp nhiều lần V1 cho cùng một việc. **Medium** (AR-M9): đo cơ sở ở M1–M2 bằng sổ usage (hiện đặt ở M6, nên đưa lên M1).
- Vận hành: một tiến trình + SQLite là nhẹ. Độ phức tạp tăng chủ yếu do số khái niệm, không do hạ tầng.

### 2.13 MVP có quá lớn không

**Có.** R0→M2 ước 29–48 ngày công, trong đó M2 là XL. MVP đang gồm: Host đầy đủ lõi, Pack Registry, Engagement, API agent, hai runtime adapter, dispatch đa Project đa slot, Knowledge tối thiểu, Approval, Inbox, MCP, UI 6 màn. Với một người, rủi ro "chưa tới MVP đã mất đà" cao (T1, T2 ở 06). Đề xuất MVP thu gọn (AR-H2, §8).

### 2.14 Chức năng hoãn được mà không ảnh hưởng kiến trúc dài hạn

| Hoãn được | Điều kiện để hoãn an toàn |
|---|---|
| Organization (bảng, UI) | Mọi bảng đã có `project_id` làm ranh giới; thêm `org_id` sau bằng migration có giá trị mặc định |
| Agent Instance là thực thể riêng | Dispatch dùng slot của node; thêm Instance khi có Seat dedicated (M4/M5) |
| Pack Registry đầy đủ | `packs/` là thư mục, có `version` |
| Standing Approval, TTL/leo thang, ủy quyền | Approval có trường `kind`, `state` mở rộng được |
| Mức tự chủ L0–L4 | Lưu `autonomy` dạng chuỗi, MVP chỉ dùng hai giá trị |
| Workflow Definition/Instance/Patch | Task có `parentTaskId`, `dependencies`; Workflow Instance thêm sau như lớp trên Task |
| CTR thành thực thể riêng | Nếu hợp nhất vào Task (AR-M1), không cần nữa |
| ACP (dùng native OpenCode trước) | `RuntimeAdapter` giữ interface ACP-compatible |
| Circuit breaker nhiều phạm vi | Ngân sách theo Task/ngày có từ M1 |
| A2A, mTLS, secret broker, HA | Đã ở ngoài MVP |
| Custom business status theo workflow | MVP dùng category cố định (backlog/planned/active/review/done) |

**Không nên hoãn** (đổi sau tốn kém): ID và thời gian, event log theo Project + cursor, lease/epoch, ranh giới side effect, phân tầng trạng thái Task/Attempt, cách lưu Artifact theo hash, cô lập agent khỏi control plane.

---

## 3. Mô phỏng tình huống

| # | Tình huống | Xử lý được? | Thiếu gì | Rủi ro |
|---|---|---|---|---|
| **S1** | Hai Project cùng yêu cầu một Team | **Có** (02 §6: hàng đợi Team, ưu tiên Engagement, aging, không cướp việc đang chạy; Session tách theo Project) | Giá trị hạn mức mặc định mỗi Engagement; chi phí Team Lead triage mỗi yêu cầu chưa đo | Low |
| **S2** | BA gọi Architecture Team khi worker offline | **Có**: CTR bền vững; Task BA nhả slot theo wait budget (C-09), hold `cross-team`; sau ngưỡng chuyển Blocked có lý do | Trong topology laptop, "offline" thường là cả laptop tắt → control plane cũng tắt; không có thông báo ra ngoài | Low |
| **S3** | Research bàn giao tài liệu cho Dev sau 30 ngày | **Có**: Artifact Approved bất biến, Dossier, Resume Briefing, `validUntil`, chia sẻ pinned | Giá trị `validUntil` mặc định theo loại Artifact chưa có; Dossier được cập nhật bởi ai ở MVP (chưa có Workflow) | Low |
| **S4** | Hai agent cùng cập nhật một Artifact | **Có một phần**: chỉ Team chủ tạo version (O4), version bất biến, CAS theo revision → người thứ hai nhận conflict | Không có hỗ trợ gộp; hai Seat cùng Team cùng sửa working copy chưa có quy tắc khóa | Medium (AR-M10) |
| **S5** | Agent chạy Task lâu bị mất kết nối | **Có**: lease, self-fencing, epoch, reconcile, không replay (03 K1, K2) | Trường hợp VM bị suspend (AR-M7) | Medium |
| **S6** | Workflow chờ người dùng phê duyệt | **Có** từ M5 (Approval bền vững, Suspended nhả tài nguyên, TTL, nhắc). **Trước M5** chỉ có câu hỏi nghiệp vụ trong Inbox | Execution Gate (C-04) không có ở MVP (AR-M5) | Medium |
| **S7** | Server chạy nhưng Windows PC tắt | **Không trong giai đoạn phát triển**: "server" là VM trên chính laptop. **Có từ M2b** khi control plane lên máy luôn bật | Đã chấp nhận ở 05 §21 | Chấp nhận |
| **S8** | Người dùng đổi Project Scope giữa chừng | **Có** từ M5 (Change Request, phân tích tác động, patch); **trước M5** xử lý tay qua Lead, không có phân tích tác động tự động | Không | Medium (chấp nhận ở MVP) |
| **S9** | Agent yêu cầu tác vụ nguy hiểm hoặc vượt quyền | **Có ở mức thiết kế** (grant, Effect Executor, Approval, không tự duyệt hành động không đảo ngược). **Ở MVP: không đủ** — agent có Bash cùng user với control plane (AR-C1); sandbox đến M6 | Cô lập user/sandbox ngay ở M2 | **Critical** |
| **S10** | Nhiều agent gọi nhau liên tục gây tăng chi phí | **Có ở mức thiết kế** (hop, vòng, ngân sách chuỗi gốc, circuit breaker). **Thời điểm hiện thực sai**: CTR ở M3, giới hạn ở M5 | Đưa hop + ngân sách chuỗi gốc vào cùng milestone với CTR | High (AR-H3) |

---

## 4. Danh sách vấn đề

### 4.1 Critical

| ID | Vấn đề | Căn cứ |
|---|---|---|
| **AR-C1** | **Bậc C0/MVP chạy code agent cùng user hệ điều hành với control plane**: Bash của agent đọc được DB SQLite (mọi Project), kho Artifact, cấu hình có key 9Router. Trái P2 (05 §5.2), E-11; kiểm quyền tri thức ở MCP (02 §16) bị vượt qua; rủi ro lớn hơn V1 vì gom nhiều Project | 05 §4.3 bậc C0; V1 `runtime/permissions.ts`; ADR-T14 |

### 4.2 High

| ID | Vấn đề | Căn cứ |
|---|---|---|
| **AR-H1** | **M0 chốt quá nhiều thực thể** (Workflow, Standing Approval, Budget nhiều cấp, Effect, Pack, Organization...) trước khi có Task đầu tiên chạy; rủi ro thiết kế sai mà khóa sớm | 06 §4 M0 |
| **AR-H2** | **MVP quá lớn** (29–48 ngày công, M2 là XL) cho một người | 06 §3.2, §5 |
| **AR-H3** | **Cơ chế an toàn đến muộn hơn rủi ro**: CTR (M3) trước ngân sách/hop/circuit breaker (M5); đẩy branch ra ngoài (M2) trước Effect Executor (M4); sandbox (M6) sau khi agent chạy thật (M2) | 06 §4 |
| **AR-H4** | **Không có sao lưu định kỳ** từ M2 tới M6 trong khi dùng hằng ngày; dữ liệu nằm trong ổ ảo WSL | 06 §4 M6; 05 §21 |
| **AR-H5** | **Hai runtime adapter ở M2** (ACP + native) nhân đôi việc; `opencode acp` chưa được kiểm trong repo, còn adapter native từ V1 đã chạy thật | 06 §4 M2; OSS-02 |
| **AR-H6** | **Lead chạy bằng API agent không đọc được repo**; tool MCP của control plane không có workspace. Lập kế hoạch code kém hơn V1 | 05 §9.3, ADR-T06 |

### 4.3 Medium

| ID | Vấn đề |
|---|---|
| AR-M1 | CTR là thực thể và state machine riêng trùng với Task; nên là Task có `origin=cross-team` + `requestKind`; `clarify/consult` là tin nhắn trong thread |
| AR-M2 | Agent Instance chưa có hành vi riêng ở MVP; dùng slot node ngầm định |
| AR-M3 | 13 abstraction thay công nghệ; chỉ giữ 5 (§2.3) |
| AR-M4 | 02 §5.1 và 01 chưa cập nhật theo ADR-T04, I1 |
| AR-M5 | Execution Gate (C-04) không có chỗ đặt trước M5 |
| AR-M6 | Lỗi tool MCP (control plane không truy cập được) chưa có quy tắc: agent có thể tưởng thành công |
| AR-M7 | VM bị suspend làm lệch lease; node phải dừng ngay khi gia hạn thất bại/bị từ chối, kiểm cả đồng hồ thực |
| AR-M8 | Node Windows chạy bằng WinSW phải dùng tài khoản người dùng để thấy đăng nhập runtime |
| AR-M9 | Chưa đo chi phí token cơ sở; sổ usage đặt ở M6 |
| AR-M10 | Hai Seat cùng Team sửa một working copy Artifact chưa có quy tắc khóa |

### 4.4 Low

| ID | Vấn đề |
|---|---|
| AR-L1 | `validUntil` mặc định theo loại Artifact chưa định nghĩa |
| AR-L2 | Hạn mức mặc định mỗi Engagement chưa định nghĩa |
| AR-L3 | V1 Protection Guard cần quy trình ngoại lệ khi phải vá V1 |
| AR-L4 | Chưa có quy trình chuyển DB/kho file từ WSL hoặc VM laptop sang máy luôn bật (M2b) |
| AR-L5 | Ước lượng công sức chưa có số đo; độ tin cậy thấp (đã ghi ở 06) |
| AR-L6 | Thứ tự lộ trình có hai phiên bản (05 §13 đã duyệt, 06 RM-01 chờ duyệt) |

---

## 5. Đề xuất điều chỉnh

| ID | Đề xuất | Giải quyết | Ảnh hưởng |
|---|---|---|---|
| **AP-R1** | **Cô lập agent ngay từ MVP**: phiên CLI agent chạy dưới **user Linux riêng** (ví dụ `factory-agent`) không có quyền đọc thư mục state/config của Host; workspace là thư mục duy nhất được cấp; key 9Router chỉ ở tiến trình model proxy (user của Host), agent nhận token tạm. Nếu kịp, dùng sandbox-runtime (OSS-04) ngay ở M2 thay vì M6 | AR-C1, S9 | Thêm vào M2 khoảng 2–4 ngày công; không đổi kiến trúc (đúng P2/E-11) |
| **AP-R2** | **M0 thu gọn**: chỉ chốt thực thể M1–M2 cần (§9) + điểm mở rộng (`kind`, `origin`, trường tùy chọn); các thực thể khác thêm theo milestone bằng phiên bản contracts tăng dần, không phá wire | AR-H1 | M0 còn 2–4 ngày công |
| **AP-R3** | **MVP thu gọn (MVP-lite)** theo §8: một runtime, một Team mặc định từ Pack, Approval hai loại, Inbox, nhiều Project song song, cô lập agent, sao lưu định kỳ | AR-H2, AR-H5 | MVP ước 20–32 ngày công (có điều kiện) |
| **AP-R4** | **Đưa cơ chế an toàn đi cùng chức năng gây rủi ro**: ngân sách theo Task + theo ngày + sổ usage ở **M1**; hop limit + ngân sách chuỗi gốc **cùng milestone với CTR**; Effect Executor tối thiểu (đẩy branch, có Effect Record) ở **M2** | AR-H3, AR-M9, S10 | Dời việc từ M4–M6 lên sớm, tổng không đổi nhiều |
| **AP-R5** | **Sao lưu định kỳ từ M1**: `VACUUM INTO`/`sqlite .backup` + sao chép kho file sang thư mục trên ổ D: theo lịch (ví dụ mỗi giờ và khi tắt); diễn tập khôi phục là tiêu chí nghiệm thu M2; Litestream vẫn ở M6 | AR-H4 | ~1 ngày công |
| **AP-R6** | **M2 dùng adapter native OpenCode (từ V1)**; ACP đưa vào khi thêm Codex/Claude (M4) | AR-H5 | Giảm rủi ro MVP; OSS-02 vẫn giữ cho dài hạn |
| **AP-R7** | **Lead có quyền đọc repo**: API agent chạy trên node được cấp tool chỉ đọc workspace cục bộ (liệt kê, tìm, đọc file) do node cung cấp; hoặc Lead của Project code dùng CLI agent chỉ đọc như V1. Đề xuất cách 1 | AR-H6 | Thêm tool cục bộ vào node `runtime/api-agent` |
| AP-R8 | Hợp nhất CTR vào Task (`origin`, `requestKind`, `requesterTaskId`); triage là chuyển trạng thái Task Proposed → Accepted/Declined; clarify/consult là tin nhắn thread | AR-M1 | Bớt một state machine; 02 §3–§5 cần sửa |
| AP-R9 | Agent Instance ngầm định (slot) tới khi có Seat dedicated | AR-M2 | Bớt thực thể ở MVP |
| AP-R10 | Chỉ giữ 5 abstraction (§2.3) | AR-M3 | Bớt code nền |
| AP-R11 | Cập nhật 01 (Workflow Instance), 02 §5.1 (ADR-T04), 02 §14 (Approval) trước M1 | AR-M4 | Chỉ sửa tài liệu |
| AP-R12 | Execution Gate ở MVP: kế hoạch Lead tạo ra Task ở trạng thái `AwaitingGo` (khi bật), Operator bấm "Bắt đầu"; không cần Workflow | AR-M5 | Nhỏ |
| AP-R13 | Lỗi tool MCP trả lỗi có cấu trúc; node đánh dấu attempt `Failed`/`Interrupted` thay vì để agent tự diễn giải; prompt hệ thống quy định | AR-M6 | Nhỏ |
| AP-R14 | Node dừng ngay khi gia hạn lease thất bại hoặc bị từ chối; kiểm khoảng cách đồng hồ thực sau suspend | AR-M7 | Nhỏ, ở M4 |
| AP-R15 | Node Windows (WinSW) chạy bằng tài khoản người dùng | AR-M8 | Ghi vào M4 |
| AP-R16 | Khóa working copy theo Artifact (một người giữ, có hạn) | AR-M10 | Nhỏ, ở M3 |

---

## 6. Rủi ro chấp nhận tạm thời ở MVP

| Rủi ro | Vì sao chấp nhận | Khi nào xử lý |
|---|---|---|
| Không chạy 24/7 | Đã chốt VMware trên laptop | M2b |
| Một control plane, không HA | Quy mô cá nhân; có sao lưu định kỳ (AP-R5) | M6 (Litestream), sau đó tùy nhu cầu |
| Một người dùng | Đúng nhu cầu hiện tại | S3 ở 01 |
| Không có Workflow, lịch, Change Request tự động | MVP dùng Lead + Task thủ công; V1 giữ phần lịch | M5 |
| Một runtime (OpenCode native) | Đã chạy thật ở V1 | M4 |
| Không có node Windows (Codex/Claude, thư mục Windows) | Clone Project vào WSL (AP-4) | M4 |
| Chi phí token chưa tối ưu | Đo trước, tối ưu sau (AR-M9) | M6 |
| Không đăng nhập Claude/Codex cá nhân | Chưa xác minh điều khoản (R15) | AP-11 |
| Tri thức tối thiểu (Artifact version, chưa FTS5/Dossier) | Đủ cho một Team | M3 |

---

## 7. Quyết định còn chờ phê duyệt

| Nhóm | ID | Nội dung |
|---|---|---|
| Roadmap (06) | RM-01 / AP-1 | Đổi thứ tự theo lớp năng lực |
| | RM-02 | MVP = R0→M2 (đề xuất thay bằng MVP-lite, AP-R3) |
| | RM-03 / AP-4 | Clone Project vào WSL, trả kết quả bằng branch |
| | RM-04 | Nâng cấp kiểu strangler, V1 Protection Guard |
| | RM-05 | Bắt đầu bằng R0 + M0 |
| | AP-2 | Thao tác Git ở R0 (commit tài liệu, nhánh, `main`) |
| Open-source | OSS-13 | Playwright, fast-check |
| Review này | AP-R1..AP-R16 | Điều chỉnh ở §5 |
| Đã có từ trước | AP-11 | Điều khoản dùng tài khoản Claude/Codex cá nhân |

---

## 8. Phạm vi MVP-lite đề xuất (thay R0→M2 hiện tại)

| Có trong MVP-lite | Lùi lại |
|---|---|
| Project (clone vào WSL), Team mặc định "Software" từ `packs/`, Seat, Engagement tối giản | Nhiều Team, Engagement đầy đủ (M3) |
| Chat Lead (API agent + tool đọc repo cục bộ, AP-R7) | Lead bằng CLI agent |
| Task với lifecycle ADR-T04, phụ thuộc, nhiều Project song song | Workflow (M5) |
| Seat CLI = OpenCode native (từ V1), worktree, snapshot, diff | ACP, Codex, Claude (M4) |
| **Cô lập agent bằng user Linux riêng** (AP-R1) | Sandbox đầy đủ trên node từ xa (M4/M6) |
| Artifact version theo hash, xem kết quả | FTS5, provenance, Dossier (M3) |
| Approval hai loại: câu hỏi nghiệp vụ, nghiệm thu; "Bắt đầu" khi bật gate (AP-R12) | Approval đầy đủ, Standing Approval (M5) |
| Inbox "Cần xử lý" | Digest, ntfy (M5) |
| Effect Executor tối thiểu: đẩy branch có Effect Record (AP-R4) | Effect đầy đủ (M4) |
| Ngân sách theo Task/ngày, sổ usage (AP-R4) | Circuit breaker, ngân sách nhiều cấp (M5) |
| Sao lưu định kỳ sang D: + diễn tập khôi phục (AP-R5) | Litestream (M6) |
| Event log + SSE + phiên đăng nhập | — |

Ước lượng có điều kiện: **20–32 ngày công** (R0 + M0-lite + M1 + M2-lite), thay vì 29–48.

---

## 9. Phạm vi milestone đầu tiên khuyến nghị

**R0 + M0-lite**, khoảng 3–5 ngày công.

| R0 | Nội dung |
|---|---|
| Git | Commit `docs/architecture/` (00–07); nhánh làm việc; quyết định về `main` (AP-2) |
| Baseline | Chạy và lưu kết quả `npm test`, `typecheck`, `build` của V1; `npm test` của contracts |
| Guard | `scripts/factory-v2/verify-v1-protection.mjs` + quy trình ngoại lệ (AR-L3) |
| Tài liệu | Sửa 01, 02 theo ADR-T04/I1 (AP-R11) nếu được duyệt |

| M0-lite: thực thể chốt | M0-lite: chỉ để chỗ mở rộng |
|---|---|
| ID (UUIDv7) và thời gian; Project; Team; Seat; Agent Profile ref; Engagement tối giản (Team↔Project + ưu tiên) | Organization, Pack Registry, Instance |
| Task (ADR-T04: lifecycle nghiệp vụ + holds + disposition + `origin` + `requestKind` dự phòng cho AP-R8) | Workflow Definition/Instance/Patch |
| Assignment, Run Attempt (lifecycle thực thi, lease, epoch) | Standing Approval, autonomy L0–L4 |
| Artifact Version (hash, trạng thái tài liệu đủ enum) | Provenance đầy đủ, Dossier |
| Approval (`kind`: question, review, start-gate) | 5 loại Approval còn lại |
| Effect Record tối thiểu (push branch) | Effect đầy đủ |
| Usage ledger, Budget theo Task/ngày | Budget nhiều cấp, circuit breaker |
| Event + cursor theo Project; command có idempotency/revision | — |
| `RuntimeAdapter` (fake, native OpenCode, API agent) + tool đọc workspace | ACP chi tiết |
| Node + capability (hình dạng cho node trong tiến trình) | Enrollment, giao thức mạng đầy đủ (M4) |
| Bề mặt tool MCP của M1–M2 | Tool CTR, workflow, action |

**Tiêu chí nghiệm thu:** test boundary và schema đạt; property test cho Task/Attempt/Approval (fast-check); Guard V1 đạt; người dùng duyệt hình dạng mô hình (AP-3).

---

## 10. Đánh giá mức độ sẵn sàng

| Phần | Sẵn sàng? | Lý do |
|---|---|---|
| Kiến trúc tổng thể (ADR-T01, T02, T05, T07, T14) | **Có** | Nhất quán, có tiền lệ chạy thật, không có lỗi cấu trúc |
| Mô hình dữ liệu cho MVP | **Có, nếu thu gọn** (AP-R2) | Phạm vi M0 hiện tại quá rộng |
| Bảo mật cho dùng hằng ngày | **Chưa** | AR-C1 phải có biện pháp trong thiết kế M2 |
| Vận hành dữ liệu cho dùng hằng ngày | **Chưa** | AR-H4 (sao lưu) |
| Lộ trình | **Chưa chốt** | RM-01..RM-05, AP-2 chờ duyệt |
| Tài liệu | **Gần đủ** | Cần AP-R11 để tránh hiện thực theo tài liệu cũ |

## Kết luận

**Kiến trúc đủ điều kiện để bắt đầu lập trình ở phạm vi R0 + M0-lite ngay sau khi người dùng duyệt AP-2 (Git) và AP-R2 (thu gọn M0).** Những phần này không đụng V1, chi phí thấp, và chính là nơi chốt các quyết định khó đổi.

**Kiến trúc chưa đủ điều kiện để bắt đầu M1/M2 (MVP dùng hằng ngày)** cho tới khi giải quyết:
1. **AR-C1 (Critical):** duyệt AP-R1, cô lập agent khỏi control plane ngay ở MVP.
2. **AR-H2, AR-H5:** duyệt MVP-lite (AP-R3) và adapter native trước (AP-R6).
3. **AR-H3, AR-H4:** duyệt việc đưa ngân sách/usage, Effect Executor tối thiểu (AP-R4) và sao lưu định kỳ (AP-R5) vào MVP.
4. **AR-H6:** duyệt cách cho Lead đọc repo (AP-R7).
5. Quyết định thứ tự lộ trình (RM-01) và nơi đặt mã nguồn Project (RM-03/AP-4).

Không có vấn đề nào đòi đổi kiến trúc tổng thể; tất cả là điều chỉnh phạm vi, thứ tự và mức an toàn trong khung đã chọn.
