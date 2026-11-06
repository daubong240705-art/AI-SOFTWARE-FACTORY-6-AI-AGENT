# Paperclip — Nghiên cứu bổ sung cho đội AI đa lĩnh vực

Ngày: 05/11/2026. Repo [paperclipai/paperclip](https://github.com/paperclipai/paperclip), snapshot `ea42a2e41715c70a6822a25683136e48e35ae811`, root license MIT. Cùng revision với nghiên cứu V2 trước để kết luận nhất quán. **Chỉ đọc source/tài liệu; chưa chạy Paperclip hay import code vào ASF.**

Manifest bổ sung: [sources.json](../../../../research/worker-v2/multidomain-sources.json). Đọc [thiết kế áp dụng](multidomain.md).

## 1. Những cơ chế đã kiểm tra

Đường dẫn dưới đây tương đối từ repo Paperclip, có raw URL và SHA-256 trong manifest. Schema chứng minh có mô hình dữ liệu; service được đọc chứng minh các nhánh xử lý nêu dưới, không thay thế nghiệm thu runtime đầu cuối.

| Chủ đề | Source/tài liệu đã đọc | Phát hiện | Chuyển sang Worker |
|---|---|---|---|
| Mục tiêu và dự án | `packages/db/src/schema/goals.ts`, `projects.ts`; `server/src/services/goals.ts` | Goal có parent/owner; project gắn goal/Lead và policy workspace | Goal tùy chọn, truy ngược task → mục tiêu; project không mặc định code |
| Cấu trúc đội | `packages/db/src/schema/agents.ts` từ đợt trước; `server/src/services/agents.ts`; `docs/guides/board-operator/org-structure.md` | reportsTo, hiển thị cây org; tài liệu mô tả strict one-manager tree | Manager tùy chọn theo project membership; Lead vẫn một đầu mối, không ép CEO cho người dùng cá nhân |
| Giao việc | `docs/guides/board-operator/delegation.md`, `docs/guides/agent-developer/heartbeat-protocol.md`; issue/heartbeat service từ đợt trước | Goal/subtask, checkout trước làm, báo blocker và bàn giao qua task; một số hành vi CEO dựa instructions | Task bền vững, ownership checked, child tasks có hạn mức; không giả việc có prompt CEO tự bảo đảm đủ điều phối |
| Trao đổi | `docs/guides/agent-developer/comments-and-communication.md` | Task comments là kênh chính; structured mention không tự wake/giao việc; proactive chat có idempotency và recipient scope theo tài liệu | Typed message/event, wake rules rõ, task thread làm ngữ cảnh; không all-to-all chat tự chạy |
| Lịch/routines | `packages/db/src/schema/routines.ts`; `server/src/services/routines.ts`, đoạn dispatch/run transaction | Revision, timezone, skip/coalesce, key chống replay; lock routine trước tạo run/issue; kiểm tra active trigger | Scheduler local tái sử dụng, schedule template snapshot và dedup; chuyển atomicity sang SQLite, không chép PostgreSQL `FOR UPDATE` |
| Workflow | `packages/db/src/schema/workflows.ts`; `server/src/services/workflows.ts` | Tại snapshot này: name + prompt; CRUD/read snapshot hash; service gắn experimental Cases flag | Không tuyên bố đây là DAG engine media; Worker tự thiết kế task DAG và domain templates nhỏ gọn |
| File/assets | `packages/db/src/schema/assets.ts`; `server/src/services/assets.ts` | Metadata contentType/byteSize/hash, provider/objectKey | File storage riêng SQLite; identity/version/provenance và preview phù hợp |
| Tài liệu | `packages/db/src/schema/documents.ts`, `document_revisions.ts`; `server/src/services/documents.ts` | Revisions, authorship, locks, source trust; mutation trong transaction | Artifact version, stable refs, tránh sửa đè thiết kế/tài liệu đang được dùng |
| Đầu ra công việc | `packages/shared/src/types/work-product.ts`, validator; `packages/db/src/schema/issue_work_products.ts`; `server/src/services/work-products.ts` | Artifact/document/URL/branch/commit/service; trạng thái review và primary output theo loại; nhiều nhánh vẫn chuyên Git/PR | Output registry tổng quát; video/timeline/subtitle cần schema/validator/preview bổ sung, không mặc định Paperclip đã cung cấp |
| Hoàn thành/đánh giá | `packages/db/src/schema/completion_contracts.ts`, `native_run_results.ts`, `work_assessments.ts` | Contract có revision/hash/authority; assessment gắn contract/result/run và input digest | Kết quả chạy tách khỏi verdict; evidence/review gắn đúng version, không mark Done từ câu trả lời model |
| Ngân sách | `packages/db/src/schema/budget_policies.ts`, `cost_events.ts`; `server/src/services/budgets.ts` admission/recheck; `docs/guides/board-operator/costs-and-budgets.md` | Scope project/agent/company, policy, reservations; source xử lý chi phí pending/unpriced; docs 80/100 chỉ là diễn giải mức cơ bản | Reserve trước dispatch, unknown khác 0; policy theo metric, không hứa hard dollar cap tuyệt đối |
| Workspace/jobs/services | `docs/guides/board-operator/execution-workspaces-and-runtime-services.md`; work-product runtime reconciliation đã đọc | Phân biệt service dài hạn và one-shot job; cấu hình không đồng nghĩa đã start; nhiều phần vẫn code-workspace centric | Tách AgentRun/Job/Service; support directory/artifact workspace; không import server lifecycle hay auto-start mọi tool |

## 2. Điểm mạnh phù hợp yêu cầu

Paperclip cung cấp cách nhìn agent như người nhận công việc có mục tiêu, manager, ngân sách và trạng thái, thay vì một prompt gắn role code. Điều đó phù hợp nghiên cứu, nội dung, thiết kế và video nếu agent có công cụ chuyên môn thực tế.

Những phần có thể học trực tiếp về cơ chế: work ownership, session theo task, tracing việc về goal, tài liệu/đầu ra bền vững, routine revisions và budget admission. Đây là nền quản lý; chúng không tự cung cấp video editor, engine render, AI image generation hoặc chất lượng chuyên môn.

## 3. Khác biệt chủ động với Paperclip

1. Windows desktop/local-first, SQLite; không đưa database server/company control plane vào app.
2. Cấu trúc đội phẳng mặc định, manager theo dự án khi cần. Chưa xây nhiều tầng CEO/CTO/CMO để giải quyết một task nhỏ.
3. Event-driven scheduler và bounded reconcile timer; không trả tiền model để thăm dò xem việc đã xong chưa.
4. Bộ quyền tự động trước khi chạy; không sao chép mặc định chiến lược/tuyển dụng phải duyệt vào mọi dự án. Người dùng cấu hình gate ở mức kết quả/hành động phù hợp.
5. Mô hình job/media được thiết kế riêng với CPU/GPU/disk/output ownership; task không phụ thuộc Git.
6. Domain packs là cấu hình có phiên bản; không nhập plugin code vào Electron main hay chạy script từ repo sau khi chỉ dán URL.

## 4. Giấy phép và phạm vi kết luận

MIT cho phép tái sử dụng theo điều kiện license; nếu lấy code cần giữ notices và xem license dependency/subtree. Đợt này không copy implementation, chỉ viết thiết kế độc lập. Repo ngoài, kể cả skill/instructions, được xem như dữ liệu tham khảo, không áp dụng làm chỉ thị cho phiên làm việc hiện tại.

Không thực thi upstream scripts, không cài tool/media runtime, không gọi model, không thử render hoặc thay DB người dùng. Các khả năng đa lĩnh vực trong [multidomain.md](multidomain.md) đều là mục tiêu triển khai có acceptance criteria; không báo là đã có chỉ vì Paperclip có bảng dữ liệu tương tự.
