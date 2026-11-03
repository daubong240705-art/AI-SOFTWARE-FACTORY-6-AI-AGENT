# Lộ trình code và triển khai bản đầu

Ngày chốt: **04/11/2026**, Asia/Saigon. Thay đổi theo yêu cầu người dùng: bắt đầu code ngay; thực nghiệm dự án mẫu và cơ chế template làm sau khi đã triển khai được bản đầu.

Tài liệu này là **thứ tự triển khai hiện hành**, thay thế trình tự Phase 0–5 ban đầu. Các file phase cũ giữ làm backlog kỹ thuật tham khảo; không còn là điều kiện phải hoàn thành tuần tự trước lần deploy đầu. Mã mới dùng `V0-Px-xx` để không nhầm với công việc `P0-xx`…`P5-xx` cũ.

## 1. Phạm vi bản triển khai đầu — v0.1

Bản đầu là **AI Software Factory chạy được trên .14**, có dashboard, API, dữ liệu bền, queue và workflow có phê duyệt. Người dùng có thể khai báo project, nhập yêu cầu, tạo run, xem tiến độ/timeline và duyệt đặc tả.

PM/BA có thể gọi 9Router trong giai đoạn này; bốn role BE/FE/TEST/DEVOPS có giao diện/state nhưng chưa tự sửa repo, kiểm thử hay deploy sản phẩm phát sinh. Role chưa triển khai phải hiện `Chưa triển khai`; nếu chạy mô phỏng thì event/artifact phải gắn `simulated=true` và UI hiện rõ chế độ mô phỏng. Không hiển thị kết quả code/test/deploy giả như đã thực thi.

Mini Helpdesk, template tạo dự án mới, thực nghiệm end-to-end, benchmark và báo cáo được chuyển sang Phase 6. Năng lực thực thi sáu role và tích hợp ghi vào GitLab/OpenProject triển khai sau lần deploy nền tảng đầu tiên, trong Phase 5.

Không chờ toàn bộ M0 cũ để viết code. Những kiểm tra cần để biết ứng dụng chạy đúng vẫn thực hiện ngay: build, startup, migration, lưu/đọc dữ liệu, xác thực, approval gate và health check. Không yêu cầu bộ e2e/template/benchmark đầy đủ cho v0.1.

## 2. Phase 1 — Khung ứng dụng và môi trường phát triển

**Mục tiêu:** repo có một bộ khung API/dashboard/DB chạy được; chưa xây Agent thật.

**Trạng thái 04/11/2026: đã hoàn thành V0-P1-01…06.** Build/lint, migration, 6 test với DB/Redis thật và persistence qua tạo lại container đã pass trên stack dev riêng tại `.60`. Xem [kết quả và giới hạn kiểm chứng](../docs/phase-1-completion.md); chưa nghiệm thu visual trong trình duyệt, chưa deploy `.14`.

| Mã | Công việc |
|---|---|
| V0-P1-01 | Tạo cấu trúc `apps/api`, `apps/dashboard`, `orchestrator`, `agents`, `integrations`, `workers`, `shared`, `infrastructure`, `tests` |
| V0-P1-02 | Python 3.12 + FastAPI, SQLAlchemy/Alembic, lock dependency; Next.js/TypeScript + Node 22 và lockfile |
| V0-P1-03 | Compose dev cho PostgreSQL/Redis; config môi trường, `.env.example`, không lưu secret |
| V0-P1-04 | Config/log redaction, exception response, `/healthz` và `/readyz` |
| V0-P1-05 | Schema/migration tối thiểu: project, run, task, event; mở rộng execution/artifact/approval ở Phase 2 |
| V0-P1-06 | Trang dashboard khung, API client, trạng thái loading/error và hướng dẫn chạy |

**Hoàn thành khi:** một lệnh Compose chạy các dependency; API và dashboard khởi động; tạo/đọc một project được lưu qua PostgreSQL; restart không mất dữ liệu; build/lint và smoke cơ bản đạt.

**Điều kiện bắt đầu:** workspace và worker `.60` hiện đã đủ. GitLab repo/runner registration có thể chuẩn bị cùng phase; không chặn scaffold local. Chưa cần OpenProject project mới, Registry hay repo Mini Helpdesk.

## 3. Phase 2 — Run, workflow và phê duyệt

**Mục tiêu:** yêu cầu của người dùng đi qua workflow có trạng thái, lịch sử và checkpoint.

**Trạng thái 04/11/2026: đã hoàn thành V0-P2-01…07.** API run, PM/BA, RQ/outbox, checkpoint, approval/version/hash và retry/cancel đã có implementation; 27 test, gateway live và RQ worker/restart container đã được kiểm chứng. Xem [kết quả Phase 2 và giới hạn dev](../docs/phase-2-completion.md). Dashboard thao tác run và xác thực tiếp tục ở Phase 3.

| Mã | Công việc |
|---|---|
| V0-P2-01 | API project/run; danh sách, chi tiết, yêu cầu đầu vào và giới hạn một run hoạt động ban đầu |
| V0-P2-02 | State machine, task và message/event schemas; không nhúng toàn repo vào state |
| V0-P2-03 | Redis/RQ cho job dài; LangGraph checkpoint PostgreSQL; event history trong DB |
| V0-P2-04 | Khung sáu role và ma trận quyền; PM/BA tạo plan/spec, các role chưa thực thi hiển thị rõ |
| V0-P2-05 | Client 9Router, timeout/retry hữu hạn, structured output, usage và budget cấu hình |
| V0-P2-06 | Approval/reject gắn spec version, audit và chống bấm duyệt trùng; không auto-approve trên luồng người dùng |
| V0-P2-07 | Retry/cancel theo state; resume từ checkpoint và giới hạn job bị chạy lại |

**Hoàn thành khi:** nhập yêu cầu → PM/BA tạo plan/spec → dừng chờ duyệt → tiếp tục tới ranh giới chức năng đang có. Khởi động lại worker không làm mất lịch sử/checkpoint. Nếu phần development chưa có, run ở trạng thái chờ tích hợp thay vì báo completed/deployed.

Workflow kiểm chứng có thể dùng dữ liệu nhập tay hoặc model mock được đánh dấu rõ; không cần chạy Mini Helpdesk ở phase này. Kiểm tra transition, approval và persistence cần thiết được làm cùng implementation.

## 4. Phase 3 — Dashboard sử dụng được

**Mục tiêu:** thao tác trên trình duyệt, không phụ thuộc gọi API thủ công.

**Trạng thái 04/11/2026: đã hoàn thành V0-P3-01…07.** Đăng nhập/phân quyền, project/run, sáu card Agent, artifact/version/hash, approval, metrics và timeline SSE đã chạy qua dashboard. 31 test backend, lint/typecheck/build, browser acceptance desktop/mobile, reconnect và persistence qua Compose down/up đạt trên stack riêng `.60`. Xem [kết quả Phase 3](../docs/phase-3-completion.md). Chưa deploy `.14`.

| Mã | Công việc |
|---|---|
| V0-P3-01 | Đăng nhập và role viewer/approver/admin; không nhúng API/model token quản trị trong frontend |
| V0-P3-02 | Danh sách/tạo project; project config nhập tay, chưa có wizard provision template |
| V0-P3-03 | Tạo run từ yêu cầu, danh sách và trang chi tiết run |
| V0-P3-04 | Sáu card Agent, task, trạng thái thật/chưa triển khai/mô phỏng và lỗi |
| V0-P3-05 | Timeline/event; SSE có reconnect và lịch sử từ DB, không dựa riêng pub/sub |
| V0-P3-06 | Xem plan/spec/artifact, approve/reject có xác nhận version và comment |
| V0-P3-07 | Chỉ số cơ bản: thời gian, số task, số lần gọi model và token nếu có |

**Hoàn thành khi:** người dùng đăng nhập → khai báo project → tạo run → xem plan/spec và duyệt → theo dõi trạng thái trên UI; refresh trang không mất dữ liệu. Viewer không được duyệt gate.

Ưu tiên màn hình vận hành thật; chưa làm mọi màn hình thống kê, so sánh thực nghiệm hoặc export báo cáo.

## 5. Phase 4 — Triển khai nền tảng lần đầu lên .14

**Mục tiêu:** phát hành **v0.1**, có URL nội bộ truy cập được từ LAN/NetBird.

| Mã | Công việc |
|---|---|
| V0-P4-01 | Tạo/chốt GitLab repo nền tảng và protected main; đăng ký Runner `.60` đúng scope, Docker executor và concurrency 1 |
| V0-P4-02 | Dockerfile runtime, Compose `asf-control`, volume riêng và resource budget ≤4 GiB theo kế hoạch |
| V0-P4-03 | Pipeline của nền tảng: lint/build/check cơ bản, đóng gói artifact/image gắn SHA; chọn builder chạy được không privileged/socket trong job |
| V0-P4-04 | Nơi lưu image: ưu tiên bật Registry; nếu chưa có, artifact image archive theo SHA kèm checksum để chuyển/pull qua kênh deploy được kiểm soát |
| V0-P4-05 | Secret runtime và deploy identity riêng; wrapper giới hạn stack ASF, manual deployment có audit |
| V0-P4-06 | DNS `asf.lazy.local` → Caddy `.51`; upstream dashboard/API `.14:18100/18101`, TLS/ACL/forward headers |
| V0-P4-07 | Migration, health check, restart/persistence, backup DB tối thiểu ra ngoài host và cách rollback release |

**Hoàn thành khi:** mở URL nền tảng, đăng nhập, tạo project/run, xem plan/spec, duyệt và xem lịch sử sau restart. Chỉ người được phân quyền thao tác được. Image/artifact gắn đúng SHA; ứng dụng hiện hữu trên `.14` không bị ảnh hưởng.

Lần deploy này triển khai **chính ASF**, không phải sản phẩm do Agent tạo. Chưa yêu cầu Mini Helpdesk, project template, bộ e2e đầy đủ hay thực nghiệm sáu Agent end-to-end.

**Không lùi sau deploy:** xác thực, secret isolation, migration, lưu dữ liệu, smoke startup/HTTP, giới hạn tài nguyên và đường rollback. Đây là kiểm tra vận hành tối thiểu của bản được phát hành.

## 6. Phase 5 — Agent và tích hợp thật trên nền tảng đã chạy

**Mục tiêu:** phát triển tăng dần bản **v0.2**, nối các role với dịch vụ thật.

Thứ tự triển khai:

1. GitLab/OpenProject adapters và tài khoản dịch vụ giới hạn quyền; project config lưu external ID, không token plaintext trong DB/frontend.
2. PM tạo/sửa work package thật; BA lưu spec/AC/contract và liên kết evidence; tránh create trùng.
3. Worker protocol qua HTTPS, lease/heartbeat, capability, timeout/cancel/recovery; không mở DB/Redis cho coding worker.
4. BE/FE dùng OpenCode trên `.60` hoặc worker máy cá nhân, branch/workspace riêng; ban đầu một slot, sau đó thử concurrency khi tài nguyên cho phép.
5. TEST thực thi các kiểm tra theo project và ghi report/Bug; DEVOPS chạy pipeline/deploy theo gate trên candidate SHA.
6. Webhook auth/idempotency, đối chiếu artifact/SHA, budget/retry và backup/restore hoàn thiện.

Phần code của TEST/DEVOPS Agent vẫn được phát triển; việc chạy bộ kịch bản thực nghiệm với project template chỉ bắt đầu ở Phase 6. Mỗi tích hợp có smoke/check quyền phù hợp trước bật lên staging.

**Hoàn thành khi:** sáu role có implementation và evidence thật; tính năng nào chưa nghiệm thu phải hiện trạng thái tương ứng. Chưa tuyên bố đạt M0–M5 cũ chỉ dựa vào các màn hình hoặc stub.

## 7. Phase 6 — Template, dự án mẫu và nghiệm thu đầy đủ

**Mục tiêu:** bản **v0.3** chứng minh hệ thống xử lý được một dự án thực tế, sau khi ASF đã có bản chạy.

- Chốt lại Mini Helpdesk/template đầu tiên theo tính năng nền tảng đã có; tạo repo và staging riêng lúc này.
- Template versioning, project bootstrap chạy lại không tạo trùng, project-level config/secret và rollback provisioning.
- Chạy thực nghiệm yêu cầu → WP → spec → code/MR → test/fix → deploy → acceptance.
- Bộ integration/e2e/recovery/security/resource checks mở rộng; thử mất mạng và checkpoint.
- Đáp ứng demo BE/FE song song bằng thêm slot/worker nếu `.60` không đủ.
- Kiểm tra dự án thứ hai từ template; đo thời gian, token và bằng chứng thực tế.
- Hoàn thiện báo cáo, video và checklist demo theo baseline cũ.

**Hoàn thành khi:** các mốc M0–M5 liên quan có evidence thực; có ít nhất một vòng test fail → fix → pass và deployment thật. Không dùng kết quả mô phỏng làm số liệu thực nghiệm.

## 8. Đường triển khai và điểm bắt đầu

```text
Phase 1 Khung ứng dụng
  → Phase 2 Run/workflow/approval
  → Phase 3 Dashboard
  → Phase 4 Deploy ASF v0.1
  → Phase 5 Tích hợp + sáu Agent thật v0.2
  → Phase 6 Template/dự án mẫu + nghiệm thu đầy đủ v0.3
```

GitLab nền tảng/runner/đóng gói có thể làm cùng Phase 1–3 để tránh dồn toàn bộ vào Phase 4. Việc còn thiếu trên OpenProject hoặc template không ngăn code API/dashboard trước.

**Phase 1, Phase 2 và Phase 3 đã hoàn thành; điểm tiếp theo là Phase 4 — triển khai ASF v0.1 lên `.14`.** Không khảo sát lại hạ tầng đã có bằng chứng, không tạo repo demo/template trước các phần nền tảng tiếp theo.

Lộ trình này chưa gán deadline vì chưa có thông tin thời gian/nhân lực. Không coi việc cập nhật kế hoạch là đã hoàn thành code hoặc deploy v0.1.
