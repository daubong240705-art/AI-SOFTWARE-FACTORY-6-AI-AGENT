# Phase 2 — Run, workflow và phê duyệt

Phạm vi V0-P2-01…07 trong [lộ trình code v0](../plan/lo-trinh-code-v0.md). Kiểm chứng ngày **04/11/2026**, Asia/Saigon.

## Hành vi đã triển khai

- API tạo/list/chi tiết run, phân trang event history, task/artifact/approval và usage. Một run active toàn nền tảng, kể cả khi chờ duyệt; PostgreSQL partial unique index chặn tạo đồng thời.
- State machine: created → planning → waiting_approval → running → waiting_integration. Failed có retry; reject có retry tạo spec version mới; cancel chặn kết quả muộn. Không báo completed/deployed khi development chưa triển khai.
- PM tạo plan, BA tạo spec theo Pydantic/JSON schema. Ma trận quyền chỉ cho PM ghi plan, BA ghi spec; bốn role khác có trạng thái `not_implemented`, không tool; agent không có quyền approve.
- RQ JSON queue và một Linux worker, transactional outbox trong DB. Dispatcher/worker lease, heartbeat, generation/delivery fencing và PostgreSQL advisory lock bảo vệ execution/checkpoint khỏi trùng.
- LangGraph checkpoint lưu references trong schema PostgreSQL `asf_checkpoints`. Artifact đầy đủ và event/audit lưu riêng ở application tables. Giữ artifact đã commit nếu tiến trình mất trước checkpoint; không nhúng repo vào state.
- Approval gắn version/hash/artifact ID; comment và danh tính dev được lưu audit. Cùng idempotency key + payload trả cùng quyết định; payload thay đổi, spec cũ hoặc trạng thái sai bị từ chối.
- Client 9Router `/responses`: TLS/CA, timeout, retry hữu hạn, kiểm tra schema, ledger trước mỗi HTTP attempt, usage/model/latency và budget/call limit. Mặc định mock, tất cả artifact/event mô phỏng có flag.

## Kiểm chứng

Backend đã qua Ruff, mypy strict và **27 test**, gồm kiểm tra trên PostgreSQL/Redis thật ở DB dành riêng. Dashboard qua lint/typecheck/build; image API/dashboard build trên Linux worker `.60`.

Migration upgrade từ Phase 1 → checkpoint setup → downgrade Phase 1 → upgrade lại đã pass trên DB disposable; project có từ Phase 1 vẫn còn, `alembic check` không có schema drift. DB roundtrip đã được xóa sau kiểm tra.

Các tình huống được kiểm tra có chủ đích:

- Gate chờ người duyệt; spec hash/version sai; hai approval đồng thời; replay idempotency và payload conflict.
- Reject → retry → version mới, vẫn giữ artifact/audit cũ; cancel idempotent và không resume run cancelled.
- Worker mất tiến trình sau PM, hồi phục BA từ checkpoint, PM chỉ chạy một lần.
- Mất tiến trình ngay trước lưu approval interrupt; quyết định đến trong khoảng trống này vẫn tiếp tục đúng.
- Lỗi sau approval, retry giữ quyết định và artifact cũ; không phát sinh approval thứ hai.
- Hủy khi BA đang thực thi: spec muộn không được lưu; không ghi đè trạng thái cancelled.
- Redis enqueue lỗi vẫn giữ outbox; job mất được redeliver, quá giới hạn chuyển failed.
- Gateway 503 retry hữu hạn; output không đúng schema bị chặn; usage kể cả call lỗi vẫn được ghi; hết call budget không phát HTTP mới.
- Workflow mutation bị chặn ở staging/production vì chưa có auth Phase 3.

[Evidence RQ](../../evidence/phase2-rq-check.json) ghi kết quả container worker thật, persistence và tiếp tục sau restart. [Evidence gateway](../../evidence/phase2-live-check.json) ghi PM/BA live: 2 call, 700 input + 819 output = **1.519 token**, hai artifact thật và trạng thái chờ duyệt. Lượt live chạy driver trên Windows, kết nối DB/Redis thật qua SSH tunnel; sau kiểm chứng đã cancel, không tự duyệt spec thật. RQ/container test dùng mock được đánh dấu rõ, có quyết định của test fixture.

## Vận hành dev

Xem [README](../../../README.md) để dựng từ repo, API và biến cấu hình. Trên `.60`, stack riêng:

```sh
cd /home/lazy/asf-phase2-dev
sudo docker compose -p asf-phase2-check --env-file .env -f infrastructure/docker/compose.dev.yml up -d --wait
```

API `.60:18002`, dashboard `.60:13002`, PostgreSQL `.60:54332`, Redis `.60:56382` đều bind loopback. Không đổi stack Phase 1 `.60:18000/13000`; không thay dịch vụ `.14`. Stack Phase 2 mặc định mock, không lưu token gateway trên server.

Mở OpenAPI để thử workflow:

```sh
ssh -N -L 18002:127.0.0.1:18002 -L 13002:127.0.0.1:13002 lazy@192.168.1.60
```

Mở <http://localhost:18002/docs>. Tạo project → POST run mode mock → GET chi tiết tới waiting_approval → lấy spec version/hash → POST approval với UUID idempotency key mới → xem waiting_integration và events. Dashboard hiện tạo/list project và chỉ báo PM/BA đã có API; thao tác run bằng UI sẽ được làm ở Phase 3.

Alembic `0002_workflow` quản lý application schema; `python -m orchestrator.checkpoints` chạy migration chính thức của checkpoint library trong schema riêng. Không chạy nhiều tiến trình migrate đồng thời. Khi nâng DB cũ phải bảo đảm không có nhiều run active hoặc task trùng run/version/role trước khi tạo unique constraint; migration dừng khi dữ liệu vi phạm, không tự xóa dữ liệu. Rollback về Phase 1 phải dừng dispatcher/worker trước, xóa checkpoint schema và mất dữ liệu bổ sung của Phase 2. Backup trước rollback trên môi trường có dữ liệu cần giữ.

## Giới hạn và bước tiếp theo

- Actor approval là danh tính tự khai báo cho **dev loopback**; chưa có đăng nhập/role viewer/approver/admin. Không coi đây là approval production đã xác thực. Phase 3 sẽ thay bằng principal từ session.
- Budget là allowance cục bộ trước request; usage không biết giữ reservation. Gateway có thể thêm prompt/token ngoài ước lượng; muốn giới hạn chi phí cứng cần quota ở gateway/provider. Chưa có giá nên cost là null.
- Không bảo đảm exactly-once với dịch vụ model: crash sau HTTP trước lưu response có thể gọi lại, có ledger/budget và giới hạn recovery. Không hoàn tác HTTP đã gửi khi cancel.
- RQ worker/dispatcher chạy cùng control plane, được truy cập DB/Redis; đây chưa phải remote coding-worker protocol Phase 5. Không Docker socket, coding CLI, GitLab/OpenProject write hoặc deploy sản phẩm.
- Chưa nghiệm thu visual/e2e giao diện run; template, Mini Helpdesk và thử nghiệm toàn hệ thống vẫn ở Phase 6.
- Tiếp theo: **Phase 3 — đăng nhập/phân quyền và dashboard run/artifact/approval/timeline**; deploy chính thức ASF lên `.14` ở Phase 4.
