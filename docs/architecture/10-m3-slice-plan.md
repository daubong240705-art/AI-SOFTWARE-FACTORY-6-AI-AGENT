# 10 · Kế hoạch lát cắt M3 (Multi-Team, Collaboration, Knowledge)

Nguồn: [06 §M3](06-implementation-roadmap.md), [02 · Cộng tác và Tri thức](02-collaboration-and-knowledge.md) (§3 CTR, §5.3 state CTR, §7 chống vòng lặp, §8 Context, §12–16 Knowledge), [07 AP-R4, AP-R8](07-architecture-review.md), [oss-options.md](oss-options.md) (OSS-05, 06, 07 đã duyệt). Bắt đầu 08/11/2026 theo yêu cầu của người dùng.

## Nguyên tắc (giữ từ M2)

- Mỗi lát cắt: đặc tả → giao Codex qua Skill `codex-routing` → tôi review, chạy đột biến, test Windows + Linux → commit. Lát cắt có cờ rủi ro (data, security, secrets, effect ngoài) cần người dùng duyệt từng lượt Codex.
- Migration chỉ thêm số mới (0004 trở đi); 0001–0003 đóng băng. Contracts chỉ thêm, không phá wire.
- **Không đổi hành vi M2**: mọi tính năng M3 sau cờ hoặc bổ sung; Project hiện có chạy một Team mặc định như trước (rollback theo 06: tắt Multi-Team bằng cờ).
- **AP-R4**: hop limit và ngân sách theo chuỗi gốc đi CÙNG lát cắt với CTR (không để cửa sổ M3 không có trần chi phí).
- **AP-R8 đã chốt**: một CTR *là* một Task (`origin.kind = 'cross-team'`, đã có trong contracts); không tạo thực thể thứ hai.

## Rủi ro cần nói thẳng

- M2 chưa qua "5 ngày dùng thật" và chưa chạy với model thật. M3 thêm nhiều bề mặt trên nền đó; nếu bạn gặp lỗi M2 khi dùng thật, việc sửa M2 sẽ được ưu tiên trước lát cắt M3 đang dở.
- Giả định B1 (agent viết L1 đủ chính xác), B2 (agent tuân thủ giao thức CTR), B9 (stale cảnh báo tràn lan) chưa được kiểm; chỉ kiểm được với model thật ở cuối M3.

## Kết quả khảo sát OSS cho M3 (theo quy tắc mỗi giai đoạn)

| Hạng mục | Kết luận | Căn cứ |
|---|---|---|
| Tìm toàn văn | **SQLite FTS5 có sẵn trong better-sqlite3 (SQLite 3.53.4)**; KHÔNG thêm dependency | Đã thử ngày 08/11/2026 (bảng dưới) |
| Tìm tiếng Việt | `unicode61 remove_diacritics 2` thô **chưa đủ**: "dang nhap" không ra "đăng nhập" vì `đ` không phân rã dấu. Cần **chuẩn hóa văn bản (NFD bỏ dấu, đ→d) ở cả lúc lập chỉ mục và lúc truy vấn**; tokenizer `unicode61`, trigram tùy chọn cho tìm chuỗi con | Thử thật, bảng dưới |
| Vector/embedding | **Hoãn** (OSS-07): `sqlite-vec` chỉ xét khi đo thấy tìm từ khóa thất bại nhiều | Giả định B3 |
| Nội dung Team Pack | BMAD-METHOD, spec-kit làm nguồn mẫu có ghi nguồn (OSS-05 đã duyệt); nội dung duyệt ở AP-6 cuối M3 | oss-options.md |
| Đồ thị tác động/stale | Tự xây trên `artifact_inputs` (đã có từ 0001); không cần thư viện đồ thị | Quy mô cá nhân |
| A2A | Chỉ ánh xạ trạng thái CTR (OSS-06), không dùng làm transport | oss-options.md |

Kết quả thử FTS5 (4 tài liệu: "Thiết kế cơ sở dữ liệu", "Đặc tả yêu cầu đăng nhập", "Báo cáo nghiên cứu thị trường", "Design the database schema"):

| Cách | "thiet ke" | "thiết kế" | "dang nhap" | "dac ta" |
|---|---|---|---|---|
| unicode61 thô | ra | ra | **không** | **không** |
| unicode61 + chuẩn hóa riêng | ra | ra | ra | ra |
| trigram thô | **không** | ra | **không** | **không** |
| trigram + chuẩn hóa riêng | ra | ra | ra | ra |

## Lát cắt

| # | Lát cắt | Nội dung | Rủi ro / ghi chú |
|---|---|---|---|
| **K1** | **Knowledge lõi** | Migration 0004: bảng chỉ mục FTS5 (nội dung đã chuẩn hóa) cho Artifact Version; trạng thái tài liệu đủ vòng đời (Draft → In-review → Reviewed → Approved → Superseded/Rejected/Withdrawn, 02 §13, quyết định C-06); đăng ký Version mới Approved làm bản cũ Superseded; **phân tích tác động**: Version đầu vào đổi → đánh dấu `stale` các Artifact/Task phụ thuộc (đồ thị `artifact_inputs`); phân quyền đọc theo Session/Project (02 §16: nháp của Project A không đọc được từ Project B); tool MCP `knowledge.search` / `knowledge.get`; routes đọc + tìm; sao lưu/khôi phục chỉ mục (dựng lại được từ Version) | Cờ `data` (ranh giới quyền đọc) → Critical, cần duyệt |
| **O1** | **Org đầy đủ** | Team CRUD từ Pack (nhiều Team trong một Organization), Seat dedicated/elastic, Engagement có ưu tiên và hạn mức (đã có `engagements`), nhiều Team phục vụ một Project, hàng đợi Team xuyên Project (02 §6.1); cờ tắt Multi-Team | Không Critical |
| **C1** | **CTR (Cross-Team Request)** | Tool MCP `request.create` / `request.reply`; CTR là Task `origin.kind='cross-team'` (AP-R8); 6 loại, triage (accept / need-info / decline / redirect / merge), tự tạo Engagement cho clarify/consult/review (C-03), `produce` cần Project Lead/Operator; `contextGrant` (chỉ đọc đúng các tham chiếu được cấp, hết hạn khi CTR đóng); **hop ≤ 3, thread ≤ 3 vòng, dedup/gộp CTR trùng, ngân sách theo `rootId`** (AP-R4, C-10); wait budget và nhả slot (C-09) | Cờ `security` (cấp quyền đọc xuyên Team) + chi phí → Critical |
| **X1** | **Context Assembly** | Ba tầng L0/L1/L2 cho Artifact (L1 do agent viết khi đăng ký, kiểm độ dài/cấu trúc); Context Pack dựng xác định (không LLM) + Lead bổ sung; Project Dossier (Artifact sống) và Resume Briefing khi tiếp nhận lại Project sau nhiều ngày; đo kích thước/chi phí ngữ cảnh | Giả định B1, B7, B8 |
| **P1** | **Team Pack** | `packs/research-team`, `architecture-team`, `design-team` (nội dung dựa BMAD-METHOD/spec-kit, ghi nguồn; tiếng Anh mặc định); kiểm Pack bằng bộ test sẵn có | AP-6: **bạn duyệt nội dung Pack** ở cuối M3 |
| **U1** | **UI M3** | Màn Team (nhiều Team, Seat, hàng đợi), Knowledge (tìm kiếm, Version, trạng thái, stale, provenance), yêu cầu giữa Team (CTR trong Inbox/Task), Dossier/Resume | Theo mẫu UI M2 |
| **E1** | **E2E M3** | Kịch bản 02 §18.1 (Research → BA → Architecture ∥ Design → sẵn sàng chờ lệnh) bằng Fake Runtime, rồi bằng model thật có ngân sách (acceptance M3) | Cần bạn chọn model và ngân sách |

Thứ tự đề xuất: **K1 → O1 → C1 → X1 → P1 → U1 → E1**. K1 đi trước vì CTR cần `contextGrant` trên Artifact và tìm kiếm; O1 đi trước C1 vì CTR cần nhiều Team trong cùng Project.

## Tiến độ (cập nhật 08/11/2026)

| # | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| K1a | Xong | b87021b, 027baf0 | Chỉ mục FTS5 tiếng Việt, hàm quyền đọc duy nhất, tool MCP `knowledge.search/get`, route đọc; Windows 3267 / Linux 3461 test đạt; 36 đột biến bị bắt |
| K1b | Xong | 73141c1 | Lệnh vòng đời tài liệu, supersede khi duyệt, đánh dấu stale trực tiếp (migration 0005) |
| O1 | Xong | 2c1d56b | Registry Pack, lệnh Team/Engagement/Seat, Team chính, giới hạn `max_concurrent` + tạm dừng, cờ `FACTORY_MULTI_TEAM` (mặc định TẮT) |
| U1 (tab Knowledge) | Xong | b8db9d4 | Tìm kiếm, duyệt, chi tiết Artifact với Version và provenance; e2e Host thật 8/8 |
| C1a | Xong | 8864d79 | CTR bất đồng bộ: `request.create/reply/get`, triage, hop ≤ 3, dedup, tự tạo Engagement, tối đa 3 vòng rồi leo thang, quyền đọc `contextRefs` (migration 0006). C1b: xem dòng dưới |
| C1b | Xong | (commit này) | CTR blocking (park requester, nhả slot, tiếp tục bằng attempt mới với mục `Request results:`), trần chờ 24 giờ, quá hạn triage 7 ngày, hủy lan truyền, ngân sách theo root (15 yêu cầu / 40 attempt) và chặn vòng lặp (migration 0007). Chưa có test cho 2 điểm park khi runtime kết thúc đúng lúc và khôi phục lease có hold (fake runtime chưa điều khiển được) |
| X1a | Xong | (commit này) | Context Pack xác định: brief + artifact đầu vào (L1/L0) vào prompt, trần token, `omitted`/no-access không lộ tồn tại, bảng đo `context_packs` + route xem, kiểm tra L1 khi đăng ký và bắt buộc L1 khi duyệt (chỉ khi bật multi-team) (migration 0008) |
| X1b | Xong | (commit này) | Project Dossier (artifact sống, dựng xác định, bản nháp chờ duyệt) qua `dossier.refresh`, route `GET /projects/:id/dossier` (current/outdated) và Resume Briefing `GET /projects/:id/briefing` + tool agent `project.briefing` (lọc theo quyền đọc); sự kiện mới `artifact.status-changed`/`task.status-changed` để đếm thay đổi; chưa theo dõi đổi Profile/Skill và Git HEAD |
| P1 | Code xong; **chờ bạn duyệt nội dung (AP-6)** | (commit này) | 3 Team Pack tiếng Anh: `research-team` (4 seat, 4 skill), `architecture-team` (5 seat, 5 skill), `design-team` (4 seat, 4 skill), lời văn gốc, ghi nguồn BMAD-METHOD/spec-kit/Agent Skills ở `packs/NOTICE.md`; 126 test pack. Chưa kiểm: tên tool trong profile so với tên tool thật của OpenCode khi chạy model thật (E1) |
| P2 | Xong | (commit này) | Profile của seat và danh mục skill vào prompt agent, skill đọc đầy đủ qua tool `skill.get`, nội dung ghim theo digest Pack khi tạo Team (snapshot, migration 0009), digest Pack nay gồm cả skill; câu quy đổi tên tool trong prompt giải quyết chỗ chưa kiểm của P1 về tên tool dạng `factory_...` |
| V2a | Xong | (commit này) | Pack v2: seat khai báo `capabilities` và `tools`, Pack khai báo `produces`; chọn seat theo năng lực (đội research/architecture/design hết bị giao theo bảng chữ cái); lọc tool tùy chọn theo seat trong MCP (tool cốt lõi luôn được phép); `npm run pack:check`; `packs/_template`; registry bỏ qua thư mục `_`/`.`; `software-team` giữ nguyên. Nhánh mở rộng tiếp theo: V2b tool ngoài qua MCP (cần thêm dependency client MCP, sẽ xin duyệt) |
| U1 (còn lại) | Xong (chức năng, chưa làm đẹp) | (commit này) | Màn Team (tạo từ Pack, tạm dừng/lưu trữ, mời vào dự án, ưu tiên/hạn mức, slot seat, hàng đợi), tab Yêu cầu (danh sách, chi tiết, phân loại, ghi chú) và mục Yêu cầu chờ phân loại trong Inbox, tab Dossier + Resume Briefing, mục Ngữ cảnh trong Task. Quyết định tự động: Host bổ sung charter/revision/năng lực vào `GET /teams` (4b23150) vì Codex dừng đúng chỗ thiếu dữ liệu. Giao diện giữ tối giản chờ yêu cầu cải thiện sau M5; e2e Host thật 9/9 |
| E1a | Xong | (commit này) | Kịch bản 02 §18.1 với 4 Pack thật trên runtime giả, agent do kịch bản đóng vai qua MCP thật (15 test, 136 assertion): nghiên cứu, BA, yêu cầu bất đồng bộ và blocking tới kiến trúc/thiết kế, supersede và stale, requirements, Dossier, giới hạn hop/ngân sách. **Tìm ra 2 lỗi thật, đã sửa**: (1) yêu cầu tự động giao cho Lead (runtime api-agent) thay vì seat làm việc; (2) nhận review task bỏ qua cổng L1. Kèm: khi hòa tải, seat chọn theo thứ tự trong manifest (reviewer đứng cuối) thay vì theo bảng chữ cái. **E1b (model thật) còn chờ bạn: chọn model, ngân sách, cho phép dùng khóa** |
| V2b | Xong | (commit này) | Tool ngoài qua máy chủ MCP từ xa: operator đăng ký trong `FACTORY_MCP_SERVERS_FILE` (khóa lấy từ biến môi trường `env:TÊN`), Host là client MCP tối giản tự viết qua `fetch` (**không thêm thư viện, không hỗ trợ stdio** - quyết định tự động), tool hiện là `ext.<server>.<tool>`, mặc định từ chối với mọi seat trừ khi Pack khai báo rõ, giới hạn kích thước/thời gian/số lần gọi, cầu dao, che bí mật, kết quả bọc là dữ liệu không đáng tin, route `GET /mcp-servers`. Chưa hỗ trợ OAuth, resources/prompts, stdio |
| E1 | Chưa | — | Cần bạn chọn model và ngân sách |

Cũng đã làm trong lúc chờ: đóng mục "chưa kiểm đột biến" của M2 (clone/worktree/patch: 4 lỗ hổng thật được vá, commit e6d382a; chạy tiến trình: 2 lỗ hổng thật được vá, commit 5aa5a94).

## Test Cases bắt buộc (từ 06 §M3)

1. Kịch bản 02 §18.1 chạy bằng Fake Runtime. 2. CTR vượt hop 3 bị từ chối; thread quá 3 vòng tự leo thang. 3. Hai CTR trùng được gộp. 4. Session Project A không đọc được Artifact nháp của Project B. 5. Version mới Approved làm bản cũ Superseded và đánh dấu stale đúng Task phụ thuộc. 6. Tìm "thiet ke" ra "thiết kế". 7. Tiếp nhận lại Project sau nhiều ngày dựng đúng Resume Briefing.

## Điều kiện chuyển sang M4 (06)

Dùng thật 5 ngày với hai Team trên hai Project thật; AP-6 duyệt nội dung Pack.
