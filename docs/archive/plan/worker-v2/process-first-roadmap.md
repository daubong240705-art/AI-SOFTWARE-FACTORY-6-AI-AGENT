# Lộ trình mới — Quy trình trước, Host WSL2

> **Lộ trình đã hợp nhất:** [Factory V2 F0–F8](../factory-v2/delivery-plan.md) thay P0–P5 làm thứ tự mở task mới. Giữ nguyên hướng tự chủ/WSL2, thêm UI CrewHub từ đầu và tiêu chí trên 90% trong [kế hoạch hiện hành](../factory-v2/README.md). Phần dưới là lịch sử đối chiếu.

Ngày: 05/11/2026. **Chưa triển khai**. Lộ trình này thay thứ tự bắt buộc V2-01–07 khi theo hướng [process-first WSL2](process-first-wsl.md). Giữ backlog nghiệp vụ cũ để đối chiếu, không coi tất cả bảng/schema trước đây là yêu cầu implementation.

## Nguyên tắc phát triển

- Một lát cắt end-to-end nhỏ trước; không phát triển hàng loạt abstraction/editor khi chưa có đường giao việc hoạt động.
- Mọi mode phải được kiểm chứng hành vi, không chỉ có tên Full access/Automatic trong UI.
- Runtime adapter có protocol/version/capabilities rõ; chọn dependency theo nhu cầu, không đưa thêm framework điều phối chỉ để ghép agent.
- Không test/build mọi thứ sau mỗi sửa nhỏ; chạy checks đúng thay đổi, test sâu ownership/recovery/permissions và smoke flows sản phẩm.
- Ghi trạng thái đạt/chưa đạt và evidence; không reset DB hoặc chạy lại mù để che lỗi.

## P0 — Môi trường WSL2 và startup profile

Kết quả cần: biết distro/user/disk/toolchain/network nào dùng, môi trường cài và data directory ở đâu, host startup/shutdown thế nào.

- Chỉ đã xác minh WSL2 Ubuntu tồn tại; phần còn lại cần read-only preflight sau khi bắt đầu triển khai.
- Chọn Linux home cho app/source/data; verify CLI Linux, Git, Node/Python, runtime versions, provider auth, local CA/9Router khi dùng. Windows toolchain không được coi là Linux toolchain.
- Chọn profile read/write/shell/network/cache/project tools theo scope; không xin từng read/build command và không mặc định root.
- Chốt host local loopback/session/token, resource limits và behavior khi app đóng/Windows sleep/WSL shutdown.
- Chuẩn bị Linux toolchain theo recipe đã xem xét; không chạy installer từ repo chưa được kiểm tra, không overwrite distro config/credentials tự ý.

Nghiệm thu: workspace sample thực thi read/write/build thành công, profile không routine prompts; thao tác ngoài scope có kết quả denied rõ mà không tạo vòng hỏi. Startup/shutdown và dữ liệu sau restart xác minh được. Chưa chuyển DB thật.

## P1 — Lead làm việc tự nhiên với một runtime

Kết quả cần: web UI local + host trong WSL, người dùng trao đổi và giao việc thật cho Lead.

- Một runtime sẵn sàng trước, chọn theo probe/auth thực tế giữa Codex/OpenCode; không khẳng định đã xác minh chúng trong WSL.
- Chat phân biệt tư vấn, giao việc và quyết định; việc nhỏ Lead tự làm, việc lớn ghi task nội bộ.
- Workspace/tool grants đủ dùng; đọc/tìm/sửa file/build/test không phát yêu cầu Accept thường ngày.
- Task/context/output/events lưu bền vững; user thấy tiến độ và kết quả, có stop thật và lỗi đúng scope.
- Policy review theo nhu cầu, final-review hoặc auto; không yêu cầu người dùng chốt plan cho từng việc nhỏ.

Nghiệm thu: yêu cầu sửa nhỏ → runtime đọc/sửa/check → đầu ra có evidence; tư vấn không tạo task rác; thiếu quyết định thực sự hỏi một câu đúng vấn đề; reply tiếp tục đúng phần việc. Stop/restart không lặp task.

## P2 — Đội nhiều runtime và phối hợp

Kết quả cần: agent tự do, Lead tổ chức đội theo yêu cầu chứ không chuỗi role bắt buộc.

- Hoàn thiện Codex/Claude Code/OpenCode adapters và credentials/capability checks theo phiên bản đã hỗ trợ.
- Agent CRUD/template, runtime/model, per-project team/capabilities; được tự làm hoặc giao việc, dynamic agents trong hạn mức được cấp.
- Durable assignment/thread/handoff/context; ownership/fencing, scopes, parallelism và native subagent visibility/control khi hỗ trợ.
- Skill/tool registry đủ import/gắn version, MCP/CLI có recipe/config/credentials riêng. Không cần marketplace mới làm việc được.

Nghiệm thu: hai task độc lập chạy song song với runtime khác nhau; output bàn giao và Lead báo kết quả; native children nếu bật phải nhìn thấy/dừng được đúng mức quảng cáo. Runtime thiếu/quota cạn không tự đổi model tốn hơn, không làm đứng các nhánh độc lập.

## P3 — Quy trình nghiệp vụ và automation

Kết quả cần: workflow/templates/rules tùy biến, đủ vận hành kiểu Loops qua List trước rồi Graph trên cùng model.

- Project types, task templates/custom fields, business statuses và transition guards; runtime state vẫn host-owned.
- Event-condition-action engine, typed commands, simulation/explanation, lifecycle và project/rule switches; không có dispatch thứ hai.
- Schedule → event → task/job/report; timezone, occurrence dedup, skip/coalesce; host phải hoạt động.
- Human decisions/review qua Chat hoặc cards; routine automation tự bật trong policy đã cấp, không chờ vô lý.
- List/Graph round-trip, history, loop/conflict protection; layout không đổi semantics.
- Reports/comments, search/views/archive/park và output versioning khi flow cần; Git connector chỉ project có Git và có quyền.

Nghiệm thu: routing specialist bằng labels; check trước Review; lịch tạo report tự chạy; pause/resume/rule conflicts/crash không tạo trùng. Không có task chạy chỉ vì user kéo node graph hoặc đọc tin.

## P4 — Đa lĩnh vực và jobs chuyên môn

Kết quả cần: cùng lõi phục vụ research/content/design/video, không repo là một lựa chọn bình thường.

- Artifact-only và directory workspaces, typed assets/documents/media và preview/review phù hợp.
- Job lifecycle tách agent run, CPU/GPU/disk/quota reservations và chi phí known/pending/unknown.
- Research workflow và FFmpeg video cơ bản từ input có sẵn; domain packs chỉ presets có thể sửa.
- Windows tool bridge khi cần native apps là connector riêng; không hứa WSL tự điều khiển mọi app dựng/design.

Nghiệm thu: research có nguồn/output; video preview→review/export; agent rảnh trong khi render vẫn chạy có trạng thái rõ; cancel/out-of-disk/crash không nhận file dở thành output cuối. Không tự publish ngoài quyền.

## P5 — Chuyển dữ liệu, remote và phát hành

Kết quả cần: chuyển dùng hằng ngày với dữ liệu bảo toàn và giới hạn rõ.

- Import/export/backup/restore từ V1 trên bản sao; mapping/history/artifact hashes, không tự replay công việc cũ.
- Đóng gói host/UI và hướng dẫn startup; desktop wrapper tùy nhu cầu, không quyết định kiến trúc trước core workflow.
- Remote profile khi cần: host API/auth/TLS/reconnect qua LAN/NetBird; chạy trên Linux VM cũng là host target cùng protocol, không sản phẩm thứ hai.
- Kiểm thử luồng thực, recovery, resource/cost và permission profiles; ma trận Loops đánh dấu partial/verified theo evidence.

Nghiệm thu: dữ liệu cũ đọc được, dự án mới chạy đúng policy, no routine approval prompts trong ba runtimes được cấu hình; nghiệp vụ cần quyết định vẫn hỏi được; local và remote có scope đúng. Chưa đạt remote thì chỉ phát hành profile local, không gọi tương đương mọi thiết bị.

## Những gì không còn là ràng buộc

Không bắt Electron, runtime process native Windows, schema/controller hiện tại, bảy role, một kế hoạch cố định cho mọi dự án, một active run toàn app hay native subagents luôn tắt. Cũng không buộc tạo nhiều tầng manager, duyệt mọi kế hoạch hoặc hoàn thiện mọi domain pack trước lát cắt dùng được đầu tiên.

Những gì vẫn cần: rõ mục tiêu/quyền, kiểm chứng kết quả, một nguồn ownership/dispatch, dữ liệu bền vững và trải nghiệm ngắn gọn. Các thành phần này phục vụ sự linh hoạt của người dùng, không bắt người dùng quản lý kỹ thuật hằng ngày.
