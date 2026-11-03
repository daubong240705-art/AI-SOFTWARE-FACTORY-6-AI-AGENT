# Phase 1 — Nền tảng Orchestrator

> **Thời lượng gợi ý:** 2 tuần  
> **Phụ thuộc:** Phase 0 (spike S1 với 9Router, quyết định stack, phân bố hạ tầng)  
> **Tham chiếu tài liệu kiến trúc:** mục 2 (Kiến trúc), 3.2 (Cấu hình Agent), 5 (Giao tiếp & Shared State), 6.1 (Ma trận quyền), 8 (Dữ liệu), 9 (API), 11 (Cấu trúc repo)

---

## 1. Mục tiêu

Dựng bộ khung **chạy được từ đầu đến cuối** của nền tảng:

- API FastAPI, workflow LangGraph có checkpoint, PostgreSQL, Redis queue.
- Client gọi model qua 9Router.
- Schema message và Shared State.
- Khung chung cho 6 Agent, có ma trận quyền.

Cuối phase, một run mẫu đi qua đủ 6 role và toàn bộ lịch sử được lưu. PM và BA gọi model thật; BE, FE, TEST, DEVOPS còn là stub.

## 2. Phạm vi

**Trong phạm vi:** khung repo, DB + migration, schema, ma trận quyền, 9Router client, khung Agent, graph LangGraph, state machine, message routing, queue, API, logging.

**Ngoài phạm vi:**

- Tích hợp OpenProject thật (Phase 2).
- GitLab thật và sandbox coding (Phase 3).
- CI, webhook, deploy (Phase 4).
- Giao diện dashboard (Phase 5).

## 3. Điều kiện bắt đầu

- Repo `ai-software-factory` đã tạo (P0-04).
- Có URL, API key và tên model của 9Router (P0-01, S1).
- Có máy để chạy PostgreSQL + Redis (local Docker cũng được).

---

## 4. Công việc chi tiết

### P1-01. Khởi tạo repository

- Cấu trúc thư mục theo mục 11 tài liệu kiến trúc (`apps/`, `orchestrator/`, `agents/`, `integrations/`, `workers/`, `shared/`, `infrastructure/`, `tests/`).
- Python 3.12; quản lý package bằng `uv` (hoặc Poetry).
- Công cụ: `ruff` (lint + format), `mypy`, `pytest`, `pre-commit` + `gitleaks`.
- `infrastructure/docker/docker-compose.dev.yml`: PostgreSQL, Redis.
- `.gitlab-ci.yml` cho chính nền tảng: lint → type check → test.
- `README.md`: hướng dẫn chạy local trong ≤ 5 lệnh.

### P1-02. Cấu hình và secret

- `shared/config.py` dùng `pydantic-settings`, đọc từ biến môi trường.
- `.env.example` liệt kê đủ biến, không chứa giá trị thật.
- Bộ lọc log che secret (API key, token, mật khẩu) trước khi ghi.

### P1-03. Database và migration

SQLAlchemy 2.x + Alembic. Tạo 9 bảng của mục 8.1:

| Bảng | Trường chính |
|---|---|
| `projects` | `id`, `name`, `gitlab_project_id`, `openproject_project_id`, `repo_url`, `default_branch`, `staging_url` |
| `runs` | `id` (dạng `run-xxx`), `project_id`, `requirement`, `created_by`, `status`, `started_at`, `finished_at` |
| `agent_tasks` | `id`, `run_id`, `external_ref` (vd `OP-123`), `owner_role`, `title`, `depends_on`, `ac_refs`, `contract_version`, `status`, `retry_count` |
| `agent_executions` | `id`, `run_id`, `task_id`, `role`, `model`, `attempt`, `started_at`, `duration_ms`, `prompt_tokens`, `completion_tokens`, `cost`, `status`, `error` |
| `agent_messages` | `message_id`, `run_id`, `task_id`, `sender`, `recipient`, `type`, `priority`, `payload` (jsonb), `requires_response`, `correlation_id`, `created_at` |
| `artifacts` | `id`, `run_id`, `kind` (srs / ac / contract / test_report…), `version`, `uri`, `checksum`, `created_by_role`, `created_at` |
| `approvals` | `id`, `run_id`, `gate` (spec / integration / deploy / acceptance), `ref`, `decision`, `reviewer`, `comment`, `decided_at` |
| `integration_events` | `id`, `source`, `event_type`, `idempotency_key` (**unique**), `payload`, `received_at`, `processed_at`, `status` |
| `deployments` | `id`, `run_id`, `environment`, `image_tag`, `commit_sha`, `status`, `rollback_ref`, `started_at`, `finished_at` |

- Index theo `run_id` trên mọi bảng con.
- Migration chạy được cả `upgrade` lẫn `downgrade`.

### P1-04. Schema message và Shared State

- `shared/messages/`:
  - Enum `MessageType` gồm đủ các loại ở mục 5.2.
  - Model Pydantic `AgentMessage` theo mẫu mục 5.3.
- `orchestrator/state.py`: `DevelopmentState` theo mục 5.4.
- `shared/schemas/`: input/output cho từng Agent. Phase này chỉ cần bản tối thiểu; chi tiết bổ sung ở các phase sau.
- **Quy tắc:** state chỉ chứa tham chiếu (ref, ID, SHA, version), không chứa nội dung lớn như source code, file nhị phân hay lịch sử chat.

### P1-05. Ma trận quyền

- `shared/permissions/policy.yaml`: mã hóa bảng 6.1. Mỗi role có danh sách hành động được phép, kèm điều kiện (ví dụ deploy staging "chỉ khi có gate").
- Hàm `authorize(role, action, resource) -> bool`. Mọi tool call và message đều phải đi qua hàm này.
- Unit test phủ **mọi ô** của ma trận, gồm cả các ô "–" (bị cấm).

### P1-06. Client 9Router

`integrations/router9/client.py`:

- Gọi chat completion theo kiểu API đã xác minh ở S1.
- Timeout cho từng lần gọi. Retry với exponential backoff cho lỗi tạm thời (429, 5xx, timeout). Không retry các lỗi 4xx khác.
- **Model profile theo role** trong config. Ví dụ: PM/BA dùng model suy luận tốt, BE/FE dùng model mạnh về code, TEST dùng model rẻ hơn. Tên model lấy từ kết quả Phase 0.
- **Structured output:** yêu cầu JSON theo schema → parse → validate bằng Pydantic. Nếu sai thì gửi lỗi validate lại cho model để sửa, tối đa N lần.
- **Fallback model có kiểm soát:** chỉ chuyển sang model dự phòng khi được cấu hình, và ghi rõ vào log và execution record.
- Mỗi lần gọi ghi vào `agent_executions`: model, token (nếu có), latency, kết quả, lỗi.
- **Budget:** giới hạn token/chi phí cho mỗi run. Vượt giới hạn → run chuyển `BLOCKED`.

### P1-07. Khung Agent

- `agents/base.py`: class `BaseAgent` gồm:
  - `role`, `prompt` (đọc từ `prompt.md`), `allowed_tools`, `input_schema`, `output_schema`
  - `model_profile`, `timeout`, `retry_policy`, `policies` (đọc từ `policies.yaml`)
- **Tool registry:** mỗi tool khai báo nó ứng với hành động nào trong ma trận quyền. Agent chỉ gọi được tool nằm trong whitelist của mình.
- Tạo 6 thư mục `agents/{pm,ba,be,fe,test,devops}/` theo mục 3.2, mỗi thư mục có `prompt.md`, `agent.py`, `schemas.py`, `tools.py`, `policies.yaml`.
- **Context builder:** chỉ đưa vào prompt phần ngữ cảnh đúng với task hiện tại (từ ref lấy ra nội dung cần thiết).

### P1-08. Workflow LangGraph

`orchestrator/graph.py` có các node sau (theo sơ đồ mục 4):

```text
plan (PM) → analyze (BA) → spec_gate [interrupt]
  → develop: BE ‖ FE ‖ TEST soạn test case   (fan-out)
  → integrate → test
  → nếu fail: triage (PM) → develop
  → nếu pass: deploy_gate [interrupt] → deploy (DEVOPS) → smoke
  → nếu smoke fail: triage;  nếu pass: done
```

- Phase này: node BE/FE/TEST/DEVOPS là **stub**, trả output giả lập nhưng đúng schema.
- Checkpointer PostgreSQL (gói `langgraph-checkpoint-postgres`), `thread_id = run_id`.
- Human approval dùng cơ chế `interrupt` của LangGraph và resume qua API. Kiểm tra lại cú pháp theo phiên bản LangGraph được ghim.
- Nhánh triage có giới hạn `max_retries`.
- Ghim phiên bản LangGraph trong lockfile.

### P1-09. State machine cho Run và Task

- `orchestrator/state_machine.py`: các trạng thái và chuyển trạng thái hợp lệ theo mục 8.2.
  - Run: `CREATED → PLANNING → ANALYZING → WAITING_APPROVAL → DEVELOPMENT → TESTING → WAITING_DEPLOY_APPROVAL → DEPLOYING → COMPLETED`, cộng `BLOCKED`, `FAILED`, `CANCELLED`.
  - Task: `BACKLOG → READY → IN_PROGRESS → IN_REVIEW → TESTING → DONE`, cộng `CHANGES_REQUESTED`, `BLOCKED`.
- Chuyển sai → raise exception.
- Mỗi lần chuyển trạng thái phát một event (dùng cho SSE và audit).

### P1-10. Định tuyến message

Luồng xử lý một message:

1. Orchestrator nhận message.
2. Validate theo schema.
3. Gọi `authorize` cho sender.
4. Lưu vào `agent_messages`.
5. Đưa job tới recipient vào queue.
6. Nếu `requires_response = true`: theo dõi timeout. Quá hạn → nhắc lại hoặc `BLOCKED`.

- Dùng `correlation_id` để nhóm các message cùng một hội thoại.

### P1-11. Job queue

- Redis + RQ, chia queue theo loại việc: `agents`, `coding`, `integration`.
- Mọi việc tốn thời gian (gọi LLM, coding, chờ CI) chạy trong worker. HTTP request trả kết quả ngay, không giữ kết nối (mục 5.5).
- Mỗi job có timeout và retry. Job thất bại hẳn → đánh dấu task `BLOCKED`.

### P1-12. FastAPI

- Các endpoint ở mục 9, trừ webhook GitLab (làm ở Phase 4).
- `GET /api/runs/{run_id}/events`: SSE, đọc event từ Redis pub/sub, hỗ trợ header `Last-Event-ID` để nối lại khi rớt kết nối.
- Xác thực: API key hoặc JWT đơn giản. Phân quyền người dùng tối thiểu: `viewer`, `approver`, `admin`.
- Audit log cho các thao tác `approve`, `retry`, `cancel`.
- OpenAPI docs tự sinh. File này dùng để sinh client cho dashboard ở Phase 5.

### P1-13. Logging và truy vết

- Log dạng JSON, mỗi dòng có `run_id`, `task_id`, `role`, `execution_id`.
- `GET /healthz`: kiểm tra DB, Redis, 9Router.

### P1-14. Run mẫu end-to-end

- Script `scripts/demo_run.py`:
  1. Tạo project giả.
  2. Tạo run với yêu cầu mẫu.
  3. Tự động approve các gate.
  4. In ra timeline message.
- PM và BA gọi 9Router thật (output còn đơn giản). Các role còn lại dùng stub.

---

## 5. Sản phẩm bàn giao

- Repo `ai-software-factory` với khung đầy đủ, CI xanh.
- Migration tạo 9 bảng.
- API chạy được, có OpenAPI docs.
- Script `demo_run.py` và log của một run mẫu.

## 6. Tiêu chí nghiệm thu

- [ ] Làm theo README (compose + API + worker) là chạy được local
- [ ] Migration tạo đủ 9 bảng; `upgrade` / `downgrade` đều chạy được
- [ ] `POST /api/runs` → run đi qua đủ 6 role, dừng ở spec gate, chạy tiếp sau khi approve
- [ ] Tắt worker giữa chừng rồi bật lại → run chạy tiếp từ checkpoint, không làm lại bước đã xong
- [ ] Mọi message lưu trong `agent_messages` với `run_id`, `task_id`, `correlation_id`
- [ ] Có ít nhất một lần gọi 9Router thật được ghi trong `agent_executions`, kèm model và thời gian
- [ ] Test ma trận quyền và state machine pass; CI của nền tảng xanh
- [ ] Có test chứng minh secret không xuất hiện trong log
- [ ] SSE trả event theo thời gian thực (kiểm bằng `curl -N`)

## 7. Cách kiểm chứng

| Loại | Nội dung |
|---|---|
| Unit test | Schema message, ma trận quyền, state machine, client 9Router (mock HTTP bằng `respx`) |
| Integration test | Graph với stub Agent + PostgreSQL và Redis thật (compose hoặc testcontainers) |
| Kiểm tay | Gọi API bằng `curl`; xem dữ liệu trong DB; ngắt worker để thử resume |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| API LangGraph thay đổi giữa các phiên bản | Ghim phiên bản; gói logic LangGraph trong `orchestrator/` để dễ sửa |
| Checkpoint quá lớn vì state chứa dữ liệu nặng | State chỉ lưu ref; nội dung lưu ở `artifacts` |
| Làm phần nền quá kỹ, trễ các phase sau | Giữ stub đơn giản; ưu tiên chạy được end-to-end trước rồi mới làm sâu |
| 9Router chậm hoặc lỗi trong lúc dev | Có chế độ "mock LLM" trả output cố định để dev và test offline |
