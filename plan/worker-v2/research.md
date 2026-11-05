# Worker V2 — Nghiên cứu source và quyết định tái sử dụng

Ngày: 05/11/2026. Đây là khảo sát tĩnh source và tài liệu, **không phải kết quả chạy thử các sản phẩm tham khảo**. Không chạy script, installer, hook hoặc skill lấy từ repo ngoài. Không chép source hay asset upstream vào sản phẩm.

Nghiên cứu mở rộng cùng ngày về goals, org/delegation, routines, documents/work products, completion contracts và budget: [Paperclip cho đội đa lĩnh vực](paperclip-multidomain-research.md). Kết quả áp dụng và giới hạn 2.0/2.1 trong [thiết kế mở rộng](multidomain.md).

Manifest đường dẫn, revision và SHA-256: [sources.json](../../research/worker-v2/sources.json). Các bản tải nằm trong `.cache/worker-v2-research/`, bị Git ignore. Snapshot là commit được GitHub trả về tại thời điểm khảo sát; không tự cập nhật theo nhánh upstream.

## 1. ASF hiện tại

| Điểm kiểm tra | Bằng chứng trong workspace | Hệ quả với V2 |
|---|---|---|
| Agent cố định | `apps/windows-worker/shared/contracts.ts`: enum role, agents length 7; `shared/defaults.ts`: bảy cấu hình mặc định | Agent ID độc lập tên/vai trò; default chỉ là template |
| Kế hoạch theo role | `shared/team.ts`: worker role enum, task limit 10; `electron/team/role-policy.ts`: quyền theo tên role | Task nhận agent ID/capability; giữ giới hạn hữu hạn nhưng cấu hình được |
| Runtime duy nhất | `electron/runtime/opencode.ts`: OpenCode, route `nine_router`, tắt external skills và subagent, MCP rỗng | Adapter + runtime connection; skill/tool injection có kiểm soát |
| Controller bị ghép nhiều trách nhiệm | `electron/controller/runs.ts`: active run, runtime/proxy/skills/permissions/worktree | Tách scheduler, execution service và adapter; một nguồn quyết định dispatch |
| Song song hạn chế | `electron/team/dispatch.ts`: scope, dependency và quy tắc TEST theo role; còn ràng buộc active run | Scheduler nhận task DAG, contract/source và concurrency budget |
| Skills nội bộ | `electron/team/skills.ts`: catalog nội bộ, chọn theo role | Package registry và binding theo agent/task |
| Thành phần có giá trị | SQLite task/attempt/event; worktree, stop, recovery, command/file evidence, tài liệu BA, chat/feed | Tái sử dụng theo boundary; không thay DB/renderer/runtime cùng một lần |

Các sửa lỗi trước baseline đã có: timeout thực thi, hiển thị task theo agent, lưu/xuất tài liệu BA và căn nội dung task. V2 cần mở rộng khả năng, không ghi lại chúng thành lỗi chưa xử lý.

## 2. CrewHub classic

Repo: [EKINSOL-DEV/crewhub](https://github.com/EKINSOL-DEV/crewhub). Commit: `1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1`. Giấy phép gốc: **AGPL-3.0**.

| Source đã đọc | Phát hiện | Áp dụng |
|---|---|---|
| [`connections/base.py`](https://github.com/EKINSOL-DEV/crewhub/blob/1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1/backend/app/services/connections/base.py) | Abstraction kết nối/session và capability không đồng nhất giữa backend | Registry runtime và capability probe, không đoán mọi adapter đều gửi/dừng được |
| [`connections/connection_manager.py`](https://github.com/EKINSOL-DEV/crewhub/blob/1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1/backend/app/services/connections/connection_manager.py) | Quản lý nhiều kết nối và trạng thái | Trang Kết nối có lifecycle và chẩn đoán riêng |
| [`connections/codex.py`](https://github.com/EKINSOL-DEV/crewhub/blob/1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1/backend/app/services/connections/codex.py) | Stub: kiểm tra `--version`; session rỗng; gửi tin chưa triển khai | Không lấy làm adapter Codex chạy được; dùng tài liệu App Server chính thức |
| [`connections/claude_code.py`](https://github.com/EKINSOL-DEV/crewhub/blob/1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1/backend/app/services/connections/claude_code.py) | Đọc session, lịch sử và quản lý gửi qua process riêng | Phân biệt session quan sát và session do Worker sở hữu |
| [`services/handoff.py`](https://github.com/EKINSOL-DEV/crewhub/blob/1bd8bb8ebf8daa6ff3f82a58cbc9dc7d5961b7c1/backend/app/services/handoff.py) | Handoff chủ yếu sang terminal/VSCode/clipboard | Không nhầm với giao thức bàn giao task giữa agent |
| `backend/app/services/agent_service.py`, `frontend/src/components/sessions/ConnectionsView.tsx` | Agent registry và thao tác kết nối rõ hơn fixed-role settings | Tách hồ sơ agent, kết nối runtime và session thực thi |

Học cách phân chia chức năng và trải nghiệm; viết implementation độc lập. Không sao chép code/UI assets AGPL vào ASF trong kế hoạch này. Nếu sau này muốn tái sử dụng trực tiếp cần đánh giá nghĩa vụ giấy phép, cách phân phối và dependency cụ thể trước.

## 3. CrewHub World và Loops

Repo: [EKINSOL-DEV/crewhub2](https://github.com/EKINSOL-DEV/crewhub2). Commit: `3a66363c9e799570887d72b18370d30112cd8e47`. AGPL-3.0.

- `README.md` nói rõ World hiện mô phỏng hoạt động; bridge và adapter thực là công việc tương lai tại snapshot này.
- `packages/protocol/README.md` là khung protocol, không chứng minh điều phối agent thật.
- `docs/DESIGN_SYSTEM.md` có semantic tokens và component primitives. ASF nên xây bộ nền nhất quán, dùng typography hiện có và không sao chép thương hiệu/asset.
- [CrewHub Loops](https://crewhub.dev/loops) công bố luồng ticket → Lead → thực hiện → report → review, onboarding CLI, chat, subtasks và lịch. Xếp vào **nguồn ý tưởng sản phẩm**; source classic/World đã xem không xác minh toàn bộ tính năng Loops.
- Thư mục `crewhub/` trong workspace là bộ ảnh người dùng, không phải checkout source. Tiếp tục tạm dừng 3D.

## 4. Paperclip

Repo: [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Commit: `ea42a2e41715c70a6822a25683136e48e35ae811`. Giấy phép gốc: **MIT**.

| Source đã đọc | Cơ chế có giá trị | Lựa chọn cho ASF |
|---|---|---|
| [`packages/adapter-utils/src/types.ts`](https://github.com/paperclipai/paperclip/blob/ea42a2e41715c70a6822a25683136e48e35ae811/packages/adapter-utils/src/types.ts) | Execute, environment test, session codec, skills/models, capability và usage | Interface nhỏ hơn cho desktop; có capability và lỗi chuẩn hóa |
| `packages/db/src/schema/agents.ts` | Agent tách adapter/runtime config và permissions | Agent tự do, config có schema theo adapter |
| `packages/db/src/schema/agent_task_sessions.ts` | Session gắn agent + adapter + task | Không dùng một session toàn cục cho mọi việc |
| [`server/src/services/issues.ts`](https://github.com/paperclipai/paperclip/blob/ea42a2e41715c70a6822a25683136e48e35ae811/server/src/services/issues.ts) | Checkout nguyên tử, phát hiện conflict; chặn session cũ | SQLite claim lease + epoch + attempt fencing |
| `server/src/services/heartbeat.ts` | Wakeup, claim, stop/drain bền vững | Một scheduler local với wakeups; không cần service heartbeat riêng |
| `packages/adapters/{codex-local,claude-local,opencode-local}/src/server/execute.ts` | Runtime-specific args, stream/session, lỗi và kết quả | Adapter có lifecycle chung nhưng không giả đồng nhất mọi tính năng |

Điểm đặc biệt hữu ích: recovery yêu cầu bằng chứng provider chưa bắt đầu hoặc việc đã dừng với kết quả hành động xác định. Không tự replay lượt sửa file chỉ vì mất kết nối. Usage tích lũy theo session phải tính delta; giá chưa biết phải hiện chưa biết, không mặc định bằng 0.

Không nhập company hierarchy, database server, toàn bộ heartbeat/control-plane hoặc cơ chế deployment của Paperclip. Nếu tái sử dụng một đoạn MIT sau này phải giữ notices và kiểm tra license của dependency/subtree; đợt này chỉ dùng ý tưởng.

## 5. Tài liệu runtime và tiêu chuẩn chính thức

| Nguồn | Điều đã xác nhận qua tài liệu | Quyết định |
|---|---|---|
| [Codex App Server](https://developers.openai.com/codex/app-server/) → [tài liệu hiện tại](https://learn.chatgpt.com/docs/app-server) | stdio JSONL; initialize, thread, turn, interrupt; resume ràng buộc provider; dynamic tools còn experimental | Dùng stdio trên Windows; ưu tiên MCP cho Factory tools; pin phiên bản và kiểm tra capability |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) | Runtime Claude Code, session, tool, MCP và streaming; có ràng buộc xác thực sản phẩm bên thứ ba | Ưu tiên TS SDK trong process riêng; API-key auth mặc định; không hứa dùng subscription login tùy ý |
| [Claude headless](https://code.claude.com/docs/en/headless) | CLI print/stream/resume; bare mode có giới hạn cấu hình và xác thực | CLI là phương án tương thích có kiểm chứng, không bật bare một cách mặc định |
| [Claude SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript) | `allowedTools` tự cho phép chứ không giới hạn mọi tool; hook/callback có đường gọi khác nhau | Không biến allow list thành lời hứa sandbox; kiểm tra autoallowed tools và hook trước chạy |
| [Claude skills](https://code.claude.com/docs/en/agent-sdk/skills), [MCP](https://code.claude.com/docs/en/agent-sdk/mcp) | Skills và MCP là cấu hình runtime cần khai báo | Materialize snapshot riêng cho run; kiểm tra discovery thực tế |
| [Agent Skills specification](https://agentskills.io/specification) | SKILL.md + references/scripts/assets; nạp theo nhu cầu; allowed-tools không phải quyền phổ quát | Registry tương thích format; metadata không tự nâng quyền |
| [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) | Host/client/server, stdio hoặc HTTP | Tách tool registry khỏi agent runtime; repo phải có hướng dẫn chạy hợp lệ |

Không suy ra hỗ trợ Codex Responses hoặc Claude API từ việc 9Router chạy được OpenCode. Model ID, auth và capability thuộc từng connection; có probe/compatibility test riêng.

## 6. Mức chắc chắn và giới hạn

- Có bằng chứng tĩnh về cấu trúc và các nhánh xử lý nêu trên; chưa chạy acceptance của CrewHub/Paperclip.
- Đã đọc LICENSE gốc của ba repo; chưa thực hiện audit pháp lý cho mọi dependency. Không có upstream code được đưa vào sản phẩm.
- Chỉ xác minh phiên bản CLI Codex/OpenCode bằng lệnh đọc; chưa gọi model thật, xác minh tài khoản hoặc cài Claude.
- Danh sách tính năng V2 là đề xuất cần triển khai, không phải bảng thông báo khả năng đã có.
- Nguồn bên ngoài có thể thay đổi. Khi triển khai phải đối chiếu phiên bản runtime được hỗ trợ; không đổi protocol chỉ theo README nhánh mới nhất.
