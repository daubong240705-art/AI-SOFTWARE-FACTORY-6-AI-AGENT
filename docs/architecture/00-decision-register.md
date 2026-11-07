# Sổ quyết định kiến trúc

| Mục | Giá trị |
|---|---|
| Mục đích | Một nơi duy nhất ghi **phương án được chọn** và **trạng thái duyệt** của mọi quyết định trong `docs/architecture/` |
| Cập nhật | 07/11/2026 |
| Nguồn quyết định | [01 §12](01-product-and-domain-model.md) (D-xx), [02 §19](02-collaboration-and-knowledge.md) (C-xx), [oss-options §1](oss-options.md) (OSS-xx) |

**Trạng thái:**
- **Đề xuất chọn**: Claude đã chọn phương án sau khi cân nhắc đánh đổi và kết quả rà soát open-source; **chờ người dùng xác nhận**.
- **Đã duyệt**: người dùng đã xác nhận. Chỉ chuyển sang trạng thái này khi có xác nhận rõ ràng.
- **Có điều kiện**: phương án phụ thuộc kết quả của một quyết định hoặc thử nghiệm khác.

Người dùng có thể xác nhận cả bảng ("duyệt tất cả") hoặc nêu từng mục cần đổi.

---

## 1. Quyết định nền tảng (tài liệu 01)

| ID | Quyết định | Phương án chọn | Lý do chính | Thay đổi so với khuyến nghị ban đầu | Trạng thái |
|---|---|---|---|---|---|
| D-01 | Mô hình tổ chức Team | **Hybrid Team Model** | Mô hình duy nhất đáp ứng cả: Team phục vụ nhiều Project, Project dùng nhiều Team, chạy 24/7, chạy trên nhiều máy (01 §5.3). Paperclip gần mô hình Persistent Team nên không thay đổi lựa chọn này; chỉ ảnh hưởng cách hiện thực | Không đổi | **Đã duyệt** (07/11/2026) |
| D-02 | Quan hệ với Factory V2 | **Mở rộng Factory V2, tự xây; không chạy thử Paperclip.** Trước F1-02, điều chỉnh contracts V2 để thêm Team, Engagement, Agent Instance, Worker Node, Cross-Team Request và trạng thái tài liệu. Học thiết kế từ mã nguồn Paperclip (MIT) ở từng ticket tương ứng. **Mốc xét lại:** sau F2 (alpha một Lead) hoặc khi F3 chậm đáng kể | Người dùng ưu tiên kiểm soát hoàn toàn mô hình (Hybrid, Engagement, Worker Node trong LAN, tiếng Việt) và giữ stack Node 22 + SQLite + WSL; chấp nhận thời gian dài hơn | Người dùng chọn cách 3 thay vì chạy thử Paperclip trước | **Đã duyệt** (07/11/2026) |
| D-03 | Topology phân tán | **Một control plane + nhiều Worker Node chủ động nhận việc qua HTTPS** | Giữ "một coordinator" của V2, không chia sẻ SQLite qua mạng, có tiền lệ worker `.60`. Không có open-source thay thế phù hợp | Không đổi | **Đã duyệt** (07/11/2026) |
| D-04 | Ai điều phối Project dùng nhiều Team | **Mặc định: Lead của Team chủ trì kiêm Project Lead** (ví dụ Dev Lead trong giai đoạn phát triển). Project Lead riêng là tùy chọn khi Project lớn | Ít agent hơn, ít token hơn, khớp kịch bản ở 02 §18 (Dev Lead kiêm Project Lead). Vai trò "Project Lead" vẫn là một Seat có thẩm quyền riêng nên tách ra sau không phải đổi mô hình | **Đổi mặc định**: trước đây đề xuất Project Lead riêng cho Project nhiều Team | **Đã duyệt** (07/11/2026) |
| D-05 | Sức chứa Agent Instance | **N slot, mặc định 1; không cho Session phục vụ nhiều Project** | An toàn ở quy mô cá nhân, mở rộng được | Không đổi | **Đã duyệt** (07/11/2026) |
| D-06 | Tri thức Team | **Promotion có duyệt**: Team Lead duyệt tri thức Team, Operator duyệt tri thức Global | Tái sử dụng mà không rò rỉ dữ liệu Project; Team Lead duyệt để Operator không bị quá tải | Làm rõ ai duyệt | **Đã duyệt** (07/11/2026) |
| D-07 | Nơi đặt control plane | **Bắt đầu trên WSL; chuyển sang máy Linux luôn bật khi dùng nhiều máy (mức M2)** | Không chặn việc phát triển hiện tại. Control plane nhẹ (Node + SQLite) nên máy nhỏ cũng chạy được, nhưng **cần xác nhận có máy luôn bật** (`.60` chưa được kiểm lại từ 04/11) | **Làm rõ bởi E-01** (07/11/2026): chuyển control plane lên Linux luôn bật ngay khi có node thứ hai; WSL chỉ cho phát triển và chế độ một máy. Vị trí cụ thể theo E-02 | **Đã duyệt** (07/11/2026) |
| D-08 | Chia sẻ Artifact xuyên Project | **Công bố rõ + tham chiếu pinned version** | Nguồn gốc rõ, không thay đầu vào ngầm | Không đổi | **Đã duyệt** (07/11/2026) |
| D-09 | Thời điểm đưa Worker Node vào lộ trình | **Thiết kế khái niệm Node ngay khi làm Host (F1-02); chạy nhiều máy thật sau mức M1** | Tránh viết lại contracts, không làm chậm bản alpha | Không đổi | **Đã duyệt** (07/11/2026) |
| D-10 | Taxonomy năng lực | **Taxonomy nhỏ có namespace + tag tự do, đặt tên ánh xạ được sang AgentSkill của A2A** | Đủ để ghép việc; không thành enum trong code; mở đường giao tiếp với hệ thống ngoài | **Thêm** căn theo A2A (OSS-06) | **Đã duyệt** (07/11/2026) |

---

## 2. Quyết định cộng tác và tri thức (tài liệu 02)

| ID | Quyết định | Phương án chọn | Lý do chính | Thay đổi so với khuyến nghị ban đầu | Trạng thái |
|---|---|---|---|---|---|
| C-01 | Mô hình giao tiếp | **Mọi thông điệp đi qua Orchestrator; yêu cầu gửi tới Team; thread trực tiếp giữa hai agent trong phạm vi một yêu cầu, tối đa 3 vòng.** Agent gọi qua MCP server của Orchestrator (OSS-03) | Truy vết đầy đủ, chống vòng lặp tập trung, chạy được qua nhiều máy; MCP để mọi runtime dùng chung một bộ tool | **Thêm** cách hiện thực bằng MCP | **Đã duyệt** (07/11/2026) |
| C-02 | Nơi đặt Task con của Cross-Team Request | **Trong Project của bên yêu cầu** | Chi phí, quyền và Artifact thuộc đúng Project | Không đổi | **Đã duyệt** (07/11/2026) |
| C-03 | Tự mời Team chưa có Engagement | **Tự tạo Engagement cho hỏi làm rõ, tư vấn, thẩm định với hạn mức nhỏ; yêu cầu tạo đầu ra cần Project Lead duyệt (Operator khi vượt ngân sách)** | Không làm phiền Operator cho câu hỏi nhỏ, vẫn kiểm soát chi phí | Không đổi | **Đã duyệt** (07/11/2026) |
| C-04 | Execution Gate | **Bật mặc định khi chuyển từ Analysis sang Execution; Operator mở; tắt được theo Project** | Đúng kịch bản "sẵn sàng nhưng chờ lệnh" | Không đổi | **Đã duyệt** (07/11/2026) |
| C-05 | Ma trận thẩm quyền | **Dùng bảng 02 §4.4 làm mặc định.** Chỉ những việc sau **bắt buộc** về Operator: thay đổi phạm vi/tiêu chí nghiệm thu, mở Execution Gate, tăng ngân sách, chi tiêu, publish ra ngoài, hành động không đảo ngược, mâu thuẫn ảnh hưởng phạm vi/chi phí, tri thức Global | Giữ quyền quyết định quan trọng cho Operator mà không biến Operator thành nút thắt (giả định B12) | Liệt kê rõ danh sách bắt buộc | **Đã duyệt** (07/11/2026) |
| C-06 | Trạng thái tài liệu | **Tách Reviewed và Approved.** Mặc định: tài liệu nhỏ gộp hai bước (Team Lead duyệt); tài liệu căn cứ (requirements, ADR, data model, API contract, UI spec) do **Project Lead Approved từng bản**, Operator **duyệt một lần cho cả gói căn cứ khi mở Execution Gate** | Giữ hai câu hỏi "đúng chuyên môn" và "được dùng làm căn cứ", nhưng Operator chỉ duyệt một lần mỗi giai đoạn thay vì từng tài liệu | **Làm rõ ai duyệt**, giảm số lần Operator phải duyệt | **Đã duyệt** (07/11/2026) |
| C-07 | Truy xuất tri thức | **Tham chiếu + metadata + đồ thị liên kết + SQLite FTS5; chưa dùng vector** | Đủ cho quy mô cá nhân, không thêm dịch vụ (OSS-07). Cần thử tokenizer tiếng Việt | **Thêm** công cụ cụ thể | **Đã duyệt** (07/11/2026) |
| C-08 | Bộ nhớ dài hạn của agent | **Không có ở mức Instance; điều đáng nhớ thành tri thức Project/Team có duyệt; tắt hoặc giới hạn tính năng memory riêng của runtime** | Instance co giãn, tránh rò rỉ giữa Project, giữ nhất quán | **Thêm** yêu cầu tắt memory của runtime | **Đã duyệt** (07/11/2026) |
| C-09 | Giao tiếp đồng bộ | **Chỉ qua yêu cầu `blocking` với wait budget mặc định 5 phút; quá hạn thì lưu checkpoint, nhả slot, mở Session mới khi có trả lời** | Tiết kiệm slot và token, chịu được mất kết nối máy | Chốt giá trị mặc định | **Đã duyệt** (07/11/2026) |
| C-10 | Giới hạn chống vòng lặp | **Tối đa 3 tầng chuyển yêu cầu, 3 vòng hỏi đáp mỗi thread, 3 vòng sửa mỗi lỗi, có trần ngân sách theo chuỗi gốc** | Giá trị khởi đầu, đo và chỉnh sau | Không đổi | **Đã duyệt** (07/11/2026) |
| C-11 | Từ nghiên cứu sang phát triển | **Mặc định cùng một Project, chuyển giai đoạn Discovery → Analysis.** Dùng Project mới chỉ khi kết quả nghiên cứu là tài sản chung cho nhiều sản phẩm | Khớp kịch bản "Dev Lead tiếp nhận ý tưởng"; giữ trọn ngữ cảnh và Dossier | Chốt mặc định | **Đã duyệt** (07/11/2026) |
| C-12 | Project Dossier | **Tài liệu sống, cập nhật tại các mốc, Project Lead review** | Chi phí một lần, tiếp nhận lại nhanh và nhất quán | Không đổi | **Đã duyệt** (07/11/2026) |

---

## 3. Quyết định open-source (oss-options)

| ID | Phương án chọn | Trạng thái |
|---|---|---|
| OSS-01 | **Không chạy thử Paperclip.** Chỉ học thiết kế và tham khảo mã nguồn (MIT, sao chép có chọn lọc phải giữ thông báo bản quyền): heartbeat có gộp, khóa nhận việc, ngân sách nhiều cấp, export/import tổ chức, Team Catalog, adapter Claude/Codex. Có thể chạy thử khi tới mốc xét lại của D-02 | **Đã duyệt** (07/11/2026) |
| OSS-02 | ACP làm giao thức adapter chính, adapter native dự phòng | **Đã duyệt** (07/11/2026) |
| OSS-03 | MCP server của Orchestrator cho tool của agent | **Đã duyệt** (07/11/2026) |
| OSS-04 | `anthropics/sandbox-runtime` (pin version) thực thi grant trên node Linux | **Đã duyệt** (07/11/2026); cần thử trong WSL khi triển khai |
| OSS-05 | Agent Skills spec; BMAD-METHOD và spec-kit làm nguồn mẫu Team Pack | **Đã duyệt** (07/11/2026) |
| OSS-06 | Tên trạng thái và capability ánh xạ được sang A2A v1 | **Đã duyệt** (07/11/2026) |
| OSS-07 | SQLite FTS5, chưa dùng vector | **Đã duyệt** (07/11/2026) |
| OSS-08 | Giữ coordinator SQLite tự xây theo V2 ADR-003; học thiết kế từ Absurd và DBOS | **Đã duyệt** (07/11/2026), theo lựa chọn D-02 |
| OSS-09 | **Litestream** sao lưu liên tục SQLite của control plane (giao thức NAS chưa xác minh) | **Đã duyệt** (07/11/2026) |
| OSS-10 | **WinSW** chạy node agent như Windows service | **Đã duyệt** (07/11/2026) |
| OSS-11 | **croner** (cron + múi giờ IANA) và **cockatiel** (retry, circuit breaker); `dagre`, `ntfy` tùy chọn (04 §22, W-18) | **Đã duyệt** (07/11/2026) |
| OSS-12 | Stack giai đoạn 6: **Fastify**, **better-sqlite3**, **Kysely**, **pino**, **OpenTelemetry**; không dùng MinIO (archived), AutoGen (đang archived) (05 §9, §19) | **Đã duyệt** (07/11/2026) |

---

## 3A. Quyết định thực thi phân tán (tài liệu 03)

Nguồn: [03 §22](03-distributed-worker.md). **E-01 làm rõ D-07** (đã duyệt cùng E-01): "mức M2" của D-07 được hiểu là **ngay khi có node thứ hai**, còn WSL chỉ dùng cho phát triển và chế độ một máy.

| ID | Quyết định | Phương án chọn | Trạng thái |
|---|---|---|---|
| E-01 | Central Coordinator 24/7 | **Có**; control plane trên Linux luôn bật ngay khi chạy nhiều máy. **Sửa 07/11/2026 (05 §21):** giai đoạn phát triển chấp nhận chưa đạt 24/7; đạt ở mốc M2b | **Đã duyệt** (07/11/2026) |
| E-02 | Vị trí control plane | **VM nhỏ chuyên dụng**; dự phòng container trên `.14`; không đặt trên `.60`. **Sửa 07/11/2026 (05 §21):** giai đoạn phát triển dùng VM `factory-cp` trên VMware của laptop; máy luôn bật chọn ở M2b | **Đã duyệt** (07/11/2026) |
| E-03 | Giao tiếp node ↔ control plane | **Chỉ HTTPS outbound từ node** qua Caddy/CA nội bộ, LAN/NetBird; long-poll; không broker | **Đã duyệt** (07/11/2026) |
| E-04 | Định danh node | **Enrollment token một lần + keypair + Operator duyệt**; credential ngắn hạn; rotate/revoke; mức tin cậy node | **Đã duyệt** (07/11/2026) |
| E-05 | Lập lịch | **Hybrid theo mô hình pull**: lọc cứng + chấm điểm; ghim máy chỉ khi node-bound hoặc Seat dedicated | **Đã duyệt** (07/11/2026) |
| E-06 | Tính di chuyển của Task | **Khai báo lớp vị trí và lớp side effect**; mặc định node-bound + irreversible | **Đã duyệt** (07/11/2026) |
| E-07 | Side effect bên ngoài | **Chỉ Effect Executor của control plane thực hiện**, có idempotency, Effect Record, reconcile | **Đã duyệt** (07/11/2026) |
| E-08 | Lease và timeout | **Lease 60 s, gia hạn 20 s, Offline sau 3 heartbeat lỡ, self-fencing, tối đa 2 lượt khôi phục** | **Đã duyệt** (07/11/2026) |
| E-09 | Workspace và kết quả code | **Git qua GitLab; node trả patch, Effect Executor commit**; Artifact theo hash | **Đã duyệt** (07/11/2026) |
| E-10 | Credential | **Sandbox chỉ có token tạm**; key 9Router trên node + ngân sách theo grant; credential ghi chỉ ở control plane | **Đã duyệt** (07/11/2026) |
| E-11 | Cô lập | **Code không tin cậy chỉ trên Linux sandbox**; Windows node chỉ workspace tin cậy | **Đã duyệt** (07/11/2026) |
| E-12 | Tận dụng V1 | **Node agent Windows chạy nền** từ module V1 không phụ thuộc Electron; V1 vẫn chạy độc lập | **Đã duyệt** (07/11/2026) |
| E-13 | Độ bền control plane | **SQLite + sao lưu liên tục** (OSS-09); chưa làm HA | **Đã duyệt** (07/11/2026) |
| E-14 | Phạm vi MVP | ~~Control plane VM + node `.60` + node Windows PC~~ → **Sửa 07/11/2026 (05 §21): VM `factory-cp` + VM `factory-node-1` trên VMware của laptop + node Windows**; GPU (RTX 4060 của laptop) qua node Windows/WSL; `.60` giữ cho hệ cũ; GitLab Runner chỉ cho CI | **Đã duyệt** (07/11/2026) |

---

## 3B. Quyết định workflow và governance (tài liệu 04)

Nguồn: [04 §25](04-workflow-and-governance.md). Người dùng duyệt toàn bộ ngày 07/11/2026.

| ID | Quyết định | Phương án chọn | Trạng thái |
|---|---|---|---|
| W-01 | Mô hình khái niệm | Tách Project Lifecycle, Workflow Definition, Workflow Instance, Task; Instance là dữ liệu bền vững có revision | **Đã duyệt** (07/11/2026) |
| W-02 | Lập kế hoạch | Template-guided, Lead-adapted; Plan Patch kiểm xác định; vượt `allowedPatches` cần duyệt | **Đã duyệt** (07/11/2026) |
| W-03 | Workflow Definition | Dữ liệu có revision (Pack); Stage gắn capability; preset Software/Video/Marketing | **Đã duyệt** (07/11/2026) |
| W-04 | Chọn Team | Danh sách ngắn xác định → Project Lead chọn → Operator ghi đè | **Đã duyệt** (07/11/2026) |
| W-05 | Tạo Project bằng ngôn ngữ tự nhiên | Intake → Project Proposal nháp → Operator xác nhận → tạo idempotent | **Đã duyệt** (07/11/2026) |
| W-06 | Trạng thái hiển thị | 5 trạng thái là projection; tách Waiting và Blocked | **Đã duyệt** (07/11/2026) |
| W-07 | Phụ thuộc, rẽ nhánh | DAG + song song + điều kiện có kiểu + rework có giới hạn; không code tùy ý | **Đã duyệt** (07/11/2026) |
| W-08 | Human Approval | Một mô hình Approval gắn ngữ cảnh, TTL, nhắc, leo thang; không tự duyệt việc không đảo ngược; Standing Approval có phạm vi và hạn | **Đã duyệt** (07/11/2026) |
| W-09 | Tạm dừng dài | Không giữ Session; Resume kiểm độ tươi + Resume Briefing | **Đã duyệt** (07/11/2026) |
| W-10 | Scheduler | Trên control plane; misfire skip, skip-if-running mặc định; pre-check xác định trước LLM | **Đã duyệt** (07/11/2026) |
| W-11 | Agent theo lịch | Session mới mỗi lần; trạng thái trong Artifact + watermark | **Đã duyệt** (07/11/2026) |
| W-12 | Thông báo | Inbox bắt buộc; ntfy tự host tùy chọn (bật hay không quyết định khi triển khai) | **Đã duyệt** (07/11/2026) |
| W-13 | Giới hạn | Ngân sách nhiều cấp có reservation; retry/recursion; circuit breaker; watchdog stall | **Đã duyệt** (07/11/2026) |
| W-14 | Mức tự chủ | Team Lead L2, Project Lead L3, L4 chỉ qua Standing Approval | **Đã duyệt** (07/11/2026) |
| W-15 | Tầng điều phối | Không có LLM điều phối toàn cục thường trực; tối đa 2 tầng LLM | **Đã duyệt** (07/11/2026) |
| W-16 | Mức xử lý | Thao tác trực tiếp → Task → Workflow nhỏ → Workflow theo template | **Đã duyệt** (07/11/2026) |
| W-17 | Đổi yêu cầu | Change Request → phân tích tác động → chỉnh phần bị ảnh hưởng; đổi phạm vi cần Operator | **Đã duyệt** (07/11/2026) |
| W-18 | Open-source giai đoạn 5 | Xem OSS-11 | **Đã duyệt** (07/11/2026) |

---

## 3C. ADR kiến trúc mục tiêu (tài liệu 05)

Nguồn: [05 §18, §20, §21](05-target-architecture.md). Người dùng chốt ngày 07/11/2026, kèm điều chỉnh VMware trên laptop thay `.60` cho giai đoạn phát triển.

| ID | Nội dung | Trạng thái |
|---|---|---|
| ADR-T01 | Modular Control Plane (một tiến trình TypeScript) + Node Agent | **Accepted** |
| ADR-T02 | SQLite + Kysely + kho file theo hash + Litestream; UUIDv7; Postgres theo điều kiện 05 §10.2 | **Accepted** |
| ADR-T03 | Contracts wire v2 (Team, Engagement, Seat, Node, Instance, Workflow Instance, Approval, Pack, Artifact Version) | **Accepted** |
| ADR-T04 | Phân tầng trạng thái 4 tầng; Task chỉ giữ trạng thái nghiệp vụ | **Accepted** |
| ADR-T05 | Giao thức control plane ↔ node | **Accepted** |
| ADR-T06 | `RuntimeAdapter`: ACP, API agent, native dự phòng; tool qua MCP | **Accepted** |
| ADR-T07 | Side effect chỉ qua Effect Executor | **Accepted** |
| ADR-T08 | Knowledge và Artifact | **Accepted** |
| ADR-T09 | Workflow engine tự xây dạng dữ liệu | **Accepted** |
| ADR-T10 | Approval là cơ chế hỏi–đáp duy nhất; Policy | **Accepted** |
| ADR-T11 | Bố cục package; sao chép có chọn lọc từ V1 | **Accepted** |
| ADR-T12 | Bảo mật và danh tính | **Accepted** |
| ADR-T13 | Quan sát (pino, OpenTelemetry, sổ usage) | **Accepted** |
| ADR-T14 | Topology C0 → C1 → C2-dev (VMware trên laptop) → C2-prod (máy luôn bật) → C3 | **Accepted** (đã sửa) |

Lộ trình mốc M0–M6 (05 §13, M2 tách M2a/M2b) thay F1-02..F9 của Factory V2.

---

## 3D. Roadmap triển khai (tài liệu 06)

Nguồn: [06](06-implementation-roadmap.md).

| ID | Đề xuất | Trạng thái |
|---|---|---|
| RM-01 (AP-1) | Đổi thứ tự theo lớp năng lực: R0 → M0 → M1 → M2 (MVP) → M3 Multi-Team/Knowledge → M4 Distributed → M5 Workflow/Automation → M6 Hardening → M7 Đa lĩnh vực → M8 Import V1; M2b khi cần 24/7. Thay thứ tự 05 §13 | **Đã duyệt** (07/11/2026) |
| RM-02 | MVP dùng hằng ngày = **MVP-lite** (07 §8: R0 → M0-lite → M1 → M2-lite), theo checklist parity 06 §5.2 | **Đã duyệt** (07/11/2026) |
| RM-03 (AP-4) | Mã nguồn Project trong MVP: clone vào filesystem WSL, trả kết quả bằng branch | **Đã duyệt** (07/11/2026) |
| RM-04 | Nâng cấp kiểu strangler: không sửa V1, V1 Protection Guard ở mọi milestone, V1 chạy song song tới M8 | **Đã duyệt** (07/11/2026) |
| RM-05 | Milestone bắt đầu lập trình: **R0 + M0-lite** (07 §9) | **Đã duyệt** (07/11/2026) |
| OSS-13 | Playwright, fast-check | **Đã duyệt** (07/11/2026) |

---

## 3E. Điều chỉnh sau Architecture Review (tài liệu 07)

Nguồn: [07](07-architecture-review.md). Người dùng duyệt toàn bộ khuyến nghị ngày 07/11/2026. Khi mâu thuẫn với tài liệu 05/06, mục này được ưu tiên.

| ID | Quyết định đã duyệt | Giải quyết | Mốc |
|---|---|---|---|
| AP-R1 | **Cô lập agent từ MVP**: CLI agent chạy dưới user Linux riêng `factory-agent` (nhóm `factory`), không đọc được thư mục state/config của Host; workspace là thư mục duy nhất được cấp (`/srv/factory/workspaces`); key 9Router chỉ ở model proxy của Host, agent nhận token tạm; dùng sandbox-runtime (OSS-04) nếu kịp | AR-C1 (Critical) | M2 |
| AP-R2 | **M0-lite**: chỉ chốt thực thể M1–M2 cần + điểm mở rộng (`kind`, `origin`, trường tùy chọn); thực thể khác thêm theo milestone bằng phiên bản contracts tăng dần | AR-H1 | M0 |
| AP-R3 | **MVP-lite** (07 §8), 20–32 ngày công có điều kiện | AR-H2 | M1–M2 |
| AP-R4 | Cơ chế an toàn đi cùng chức năng gây rủi ro: ngân sách Task/ngày + sổ usage ở M1; Effect Executor tối thiểu (đẩy branch, Effect Record) ở M2; hop limit + ngân sách chuỗi gốc cùng milestone với yêu cầu giữa Team | AR-H3, AR-M9 | M1–M3 |
| AP-R5 | Sao lưu định kỳ từ M1 (SQLite `.backup`/`VACUUM INTO` + kho file → `D:\factory-backup`, mỗi giờ và khi tắt); diễn tập khôi phục là tiêu chí nghiệm thu M2; Litestream ở M6 | AR-H4 | M1–M2 |
| AP-R6 | M2 dùng adapter native OpenCode (từ V1); ACP khi thêm Codex/Claude | AR-H5 | M2, M4 |
| AP-R7 | Lead (API agent) có tool chỉ-đọc workspace do node cung cấp | AR-H6 | M1 |
| AP-R8 | Hợp nhất CTR vào Task (`origin`, `requestKind`, `requesterTaskId`); clarify/consult là tin nhắn trong thread | AR-M1 | M0, M3 |
| AP-R9 | Agent Instance ngầm định (slot) tới khi có Seat dedicated | AR-M2 | M0 |
| AP-R10 | Chỉ giữ 5 abstraction ban đầu: `RuntimeAdapter`, `SandboxProvider`, `ModelGateway`, `Clock`, Repository (Kysely); các abstraction khác tạo khi có hiện thực thứ hai | AR-M3 | M1 |
| AP-R11 | Cập nhật tài liệu 01, 02 theo ADR-T04 và thuật ngữ Workflow Instance | AR-M4 | Trước M1 (đã làm 07/11/2026) |
| AP-R12 | Execution Gate ở MVP: Task do Lead tạo ở trạng thái `AwaitingGo` khi bật gate, Operator bấm "Bắt đầu" | AR-M5 | M2 |
| AP-R13 | Lỗi tool MCP trả lỗi có cấu trúc; attempt chuyển Failed/Interrupted, agent không tự diễn giải | AR-M6 | M2 |
| AP-R14 | Node dừng ngay khi gia hạn lease thất bại/bị từ chối; so cả đồng hồ thực sau suspend | AR-M7 | M4 |
| AP-R15 | Node Windows (WinSW) chạy bằng tài khoản người dùng | AR-M8 | M4 |
| AP-R16 | Khóa working copy theo Artifact (một người giữ, có hạn) | AR-M10 | M3 |
| AP-11 | Chưa dùng đăng nhập Claude/Codex cá nhân cho tự động hóa; chỉ API key qua 9Router, cho tới khi kiểm điều khoản từng nhà cung cấp | R15 | Liên tục |
| PoC | Kết quả PoC model routing (nhánh `poc/model-routing`): chính sách bậc theo loại Task là nền cho module `model-router` sau này; chưa tích hợp | — | Sau M1 |

---

## 4. Quy tắc chọn sau spike Paperclip (cho D-02 và OSS-01)

> **Hiện không áp dụng:** người dùng đã chọn tự xây Factory V2 và không chạy thử (07/11/2026). Giữ quy tắc này để dùng nếu chạy thử Paperclip tại mốc xét lại của D-02 (sau F2, hoặc khi F3 chậm đáng kể).

Dùng checklist ở [oss-options §2.5](oss-options.md).

| Nhóm | Tiêu chí | Yêu cầu |
|---|---|---|
| **Bắt buộc** | S1 hai Project không trộn ngữ cảnh · S3 có Execution Gate · S6 dùng được 9Router/DeepSeek · S8 chạy local, tắt được telemetry | Đạt **cả 4** |
| **Mở rộng được** | S2 quyền đọc theo yêu cầu xuyên nhóm · S4 trạng thái tài liệu · S5 agent trên máy thứ hai · S10 thêm Engagement/Worker Node/vòng đời tri thức không cần fork lớn | Đạt **ít nhất 3/4**, có sẵn hoặc thêm được bằng plugin |
| Tham khảo | S7 tiếng Việt · S9 chi phí theo kịp upstream | Ghi nhận, không chặn |

- Đạt cả hai nhóm → **dựa trên Paperclip**: domain model 01/02 hiện thực bằng plugin/adapter/team template; F1-02 Host của V2 dừng; contracts V2 dùng để định nghĩa phần mở rộng.
- Không đạt → **tự xây Factory V2**, học thiết kế từ Paperclip; tiếp tục F1-02 với các điều chỉnh contracts theo 01/02.
- Dù chọn hướng nào, các quyết định khái niệm (D-01, D-03..D-10, C-01..C-12) vẫn giữ nguyên; chỉ cách hiện thực thay đổi.

---

## 5. Lịch sử

| Ngày | Thay đổi |
|---|---|
| 07/11/2026 | Tạo sổ; Claude chọn phương án cho D-01..D-10, C-01..C-12, OSS-01..08; tất cả chờ người dùng xác nhận |
| 07/11/2026 | Người dùng chọn **tự xây Factory V2, không chạy thử Paperclip** ("cách 3"): D-02, OSS-01, OSS-08 chuyển sang Đã duyệt; quy tắc §4 tạm không áp dụng |
| 07/11/2026 | Người dùng xác nhận mọi phương án Claude đã chọn: D-01..D-10, C-01..C-12, OSS-01..OSS-08 đều **Đã duyệt**. Không còn quyết định chờ duyệt |
| 07/11/2026 | Giai đoạn 4 (tài liệu 03): thêm E-01..E-14, OSS-09, OSS-10 ở trạng thái Đề xuất chọn; E-01 làm rõ D-07 |
| 07/11/2026 | Người dùng chốt phương án giai đoạn 4: E-01..E-14, OSS-09, OSS-10 **Đã duyệt**; ghi chú làm rõ vào D-07 |
| 07/11/2026 | Đồng bộ: thêm W-01..W-18 (§3B), ADR-T01..T14 (§3C), OSS-11, OSS-12; sửa E-01, E-02, E-14 theo VMware trên laptop (05 §21) |
| 07/11/2026 | Giai đoạn 7 (tài liệu 06): thêm RM-01..RM-05, OSS-13 ở trạng thái Đề xuất chọn |
| 07/11/2026 | Người dùng duyệt toàn bộ khuyến nghị của Architecture Review (07): RM-01..RM-05, OSS-13 **Đã duyệt**; thêm §3E (AP-R1..R16, AP-11); RM-02 và RM-05 đổi sang MVP-lite và R0 + M0-lite |
