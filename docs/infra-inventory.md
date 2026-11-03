# Kiểm kê hạ tầng — AI Software Factory

Khảo sát ngày **03/11/2026**, múi giờ Asia/Saigon. Phạm vi: workspace hiện tại; SSH `.12`, `.13`, `.14`, `.51`; MCP OpenProject; các endpoint GitLab/9Router. Không thay đổi cấu hình hay deploy ứng dụng trên máy chủ. Các lời gọi model và CLI smoke test chạy thật, có tiêu thụ token.

> **Cập nhật sau khảo sát cùng ngày:** đã xóa `btl-httt` và dọn cache trên `.14`, dung lượng trống tăng lên **42.50 GiB**; đã cài CA hệ thống/Omnibus và sửa DNS `.local` trên `.13`, HTTPS verified. Các bảng dưới đây giữ baseline khảo sát ban đầu; hiện trạng sau sửa xem [nhật ký bảo trì](maintenance-2026-11-03.md). Worker được phép đặt trên máy cá nhân hoặc VM theo [phương án cập nhật](worker-options.md).

> **Cập nhật Phase 4, 04/11/2026:** đã có repo GitLab ASF, runner project Docker `.60`, pipeline và deployment qua Caddy lên `.14`. Registry vẫn tắt, dùng archive/checksum theo SHA. Hiện trạng và giới hạn mới xem [kết quả Phase 4](phase-4-completion.md); các bảng bên dưới là baseline khảo sát, không phải trạng thái triển khai mới nhất.

## 1. Kết luận

Hạ tầng đủ cho control plane và staging MVP trên `.14`. **Chưa đạt mốc M0**: còn thiếu worker/runner build cô lập, Registry, tài khoản dịch vụ giới hạn quyền và các spike ghi dữ liệu/CI/deploy/webhook. Không dùng runner shell hiện tại để chạy code Agent sinh ra.

Quyết định triển khai nằm trong [kế hoạch chốt](deployment-plan.md). Thông tin chưa xác minh được ghi rõ dưới đây.

[Kết quả probe dạng JSON](evidence/probe-results-2026-11-03.json) lưu các lần chạy kiểm chứng cuối, không chứa credential hoặc transcript model thô.

## 2. Máy chủ

| Máy | Hiện trạng xác minh | Tài nguyên tại thời điểm đo | Quyết định |
|---|---|---|---|
| `.12` / `ubuntu-server-1` | Ubuntu 26.04 LTS; Docker 29.7.2; Compose 5.5.0; OpenProject Docker stack | 4 vCPU; RAM 3.32 GiB, available ~518 MiB; swap dùng ~1.94 GiB; `/` còn 69 GiB | Giữ OpenProject; không đặt Agent/DB mới; đề xuất tăng RAM lên 6–8 GiB |
| `.13` / `gitlab-server` | Ubuntu 24.04.4 LTS; GitLab CE 19.3.1 cài Omnibus; dịch vụ đang chạy | 4 vCPU; RAM 7.75 GiB, available ~1.90 GiB; `/` còn 53 GiB | GitLab + Registry khi chuẩn bị xong; không đặt coding worker |
| `.14` / `cicd-server` | Ubuntu 24.04.5 LTS; Docker 29.9.2; Compose 5.7.0; Runner 19.5.2 | 6 vCPU; RAM 11.68 GiB, available ~9.08 GiB; swap chưa dùng; `/` 77 GiB, dùng 70%, còn 23 GiB | Control plane + staging; giới hạn tài nguyên, xử lý dung lượng trước |
| `.51` / `caddy` | Debian 13.6; Caddy 2.11.4 | 1 vCPU; RAM 512 MiB, available ~457 MiB; `/` còn 6.6 GiB | Chỉ reverse proxy/TLS |

`.14` đang chạy Safe School (frontend, 2 API, worker, nginx, PostgreSQL, Redis, ClamAV, webhook), ITCare-2026 frontend/backend và Portainer. Snapshot thấy 12 container đang chạy. Không tái sử dụng DB/Redis/network/volume của các ứng dụng đó cho ASF.

Docker `.14`: image ~8.60 GB; build cache ~33.44 GB, báo reclaimable ~27.98 GB. Chưa chạy prune. Cần chọn cache cũ để dọn trong đợt bảo trì, hoặc mở rộng đĩa; không xóa volume hay image của release đang chạy/rollback.

## 3. GitLab và Runner

- Web URL: `https://gitlab.lazy.local` → DNS `.51` → HTTP `.13:80`.
- Git SSH: `git@gitlab-ssh.lazy.local`, DNS → `.13`, port 22. Không dùng `gitlab.lazy.local` cho Git SSH vì hostname này trỏ Caddy.
- Registry: `enabled: false`; chưa có registry host/route.
- GitLab có 8 project; chưa có repo `ai-software-factory` hoặc `mini-helpdesk`. Repo local hiện dùng GitHub `origin`; chưa thêm/thay remote.
- Outbound local requests cho webhook đang bật, allowlist rỗng. Đây chỉ là cấu hình; chưa có chứng cứ webhook tới ASF.
- Chưa kiểm tra quyền bot, tạo MR, protected branches của repo mới, giới hạn API thực tế hay pipeline mới.

| Runner | Phạm vi/tag từ GitLab | Executor từ `.14` | Trạng thái |
|---|---|---|---|
| ID 1 `cicd-server` | Project runner; `ci/cd-server` | **shell** | Online |
| ID 3 `global-runner` | Instance runner; `shared`, `docker`, `deploy` | **shell** | Online |

`/etc/gitlab-runner/config.toml` có global `concurrent = 4`. Cả hai runner không có protection bắt buộc ở bản ghi khảo sát. Tag `docker` **không có nghĩa là Docker executor**.

User `gitlab-runner` thuộc nhóm `sudo`, `docker`, `deploy`. Truy cập Docker daemon cho khả năng điều khiển host; `sudo -n -l` yêu cầu mật khẩu nên chưa kết luận có sudo không mật khẩu. Không đổi cấu hình hai runner đang phục vụ ứng dụng khác trong đợt khảo sát.

## 4. OpenProject — xác minh qua MCP

- URL canonical: `https://openproject.lazy247.space`; MCP `/mcp`, server `openproject_mcp` 1.0.0, protocol `2025-03-26`.
- Phiên bản trong source image: **18.0.0**, image tùy biến `custom-openproject:dev-slim`; không suy từ tag hocuspocus 17.7.2 thành phiên bản OpenProject.
- PostgreSQL 17, memcached, web, worker, cron, proxy, hocuspocus. Module `gitlab_integration` hiện diện; work package có link GitLab MR/issues. Chưa kiểm chứng đồng bộ integration thực tế.
- MCP token hiện có thuộc user **admin**, chỉ dùng khảo sát; không đưa vào nền tảng.
- `search_projects(identifier="itcares-2026")` không có kết quả. Dự án đúng: **ITCare-2026**, identifier **`itcare-2026`**, ID **6**. Khác với dự án ItCares ID 3.
- Đã đọc đủ **6 trang, 214 ID duy nhất** qua MCP. [Snapshot có thể đối chiếu](evidence/openproject-itcare-2026-2026-11-03.json).

| Thành phần thực tế | Số lượng |
|---|---:|
| Epic | 7 |
| User story | 15 |
| Task | 186 |
| Milestone | 6 |
| WP có parent | 201 |
| Bug / Sub-task đang tồn tại trong project | 0 / 0 |

Project **bật** 7 type: Task (1), Milestone (2), Summary task (3), Epic (5), User story (6), Bug (7), Sub-task (10). Feature (4) có ở cấp instance nhưng không bật cho project mẫu.

Hiện có 180 New, 21 Backlog, 6 Scheduled, 3 Done, 2 Code Review, 2 In progress. Đây là snapshot trạng thái; không dùng ngày kế hoạch synthetic trong mô tả để suy ra tiến độ thực tế.

Project không có version/category, work package không gắn `targetVersions`; sprint S0…S5 và `Work role` nằm trong mô tả. `search_custom_fields` trả 0. Không giả định có custom field Agent/Sprint/Run.

Workflow được đọc bổ sung bằng SQL SELECT trên PostgreSQL, đối chiếu binding `project_types → type_variants → workflows`. Không ghi DB:

| Type mẫu | Workflow đang gắn | Luồng chính cho Member |
|---|---|---|
| Task, User story | ITCare - Story Task Workflow (15) | New → Backlog → Selected → In progress → Code Review → Ready for Test → Testing → Done |
| Epic | ITCare - Epic Workflow (16) | New → Backlog → In progress → Done |
| Bug | ITCare - Bug Workflow (14) | New → Open → In progress → Code Review → Ready for Test → Testing → Done |
| Sub-task | ITCare - Sub-task Workflow (13) | New → To Do → In progress → In Review → Done |
| Milestone, Summary task | Workflow mặc định (2, 3) | Chưa kiểm chứng đầy đủ các transition |

Task có nhánh In progress → Blocked → In progress; Code Review → In progress; Testing → In progress. Bug có Testing → Reopened → In progress. Sub-task có In progress → Blocked → In progress và In Review → In progress. Các workflow ITCare cũng có transition tương ứng cho Project admin/Work package editor; vẫn phải thử bằng bot project mới trước khi nghiệm thu.

Quan hệ mẫu MCP: WP 1682 `blocks` WP 1683 (relation 19). Hierarchy gồm Task dưới Epic và Task dưới User story; không ép toàn bộ Task có parent là User story.

API của bản này cung cấp link `/api/v3/workspaces/...`, vẫn có `/api/v3/projects/...`; client phải theo `_links`. Schema nói `version` đã deprecated, dùng `targetVersions`, không ghi cả hai trong một request. Update work package/MCP yêu cầu `lockVersion`.

## 5. 9Router và CLI

- `https://ai.lazy.local` → Caddy `.51` → `.56:20128` (backend theo Caddyfile, chưa SSH `.56`).
- `/api/health` trả `200 {"ok":true}`; `/v1/models` không key trả 401, có key trả 200; lần chạy script kiểm chứng cuối liệt kê 68 model ID/alias.
- API key lấy từ biến môi trường đã có `NINE_ROUTER_API_KEY`; không ghi ra file.
- Model alias thử: `coding-main`; completion lần khảo sát báo model thực `gpt-6.1-sol`. Alias có thể đổi upstream; cần ghi alias và model được trả về cho mỗi execution.

| Probe thật | Kết quả | Độ trễ | Usage |
|---|---|---:|---|
| `/v1/chat/completions` | 200, nội dung `OK` | 2.94 s | input 2493 / output 5 |
| `/v1/responses` JSON schema strict | 200, parse thành `{"ok":true}` | 2.63 s | input 2516 / output 12 |
| `/v1/responses` function call | 200, `audit_ping({"ok":true})` | 2.28 s | input 2609 / output 18 |

Chưa đo rate limit, quota, giá tiền, SLA, chất lượng sáu role hoặc model dự phòng. Gateway thêm ngữ cảnh nên token input không tỷ lệ trực tiếp với độ dài prompt gửi; lưu usage trả về, không tự ước lượng giá tiền nếu thiếu bảng giá.

Máy Windows có Codex CLI 0.166.0 và OpenCode 1.19.5. CLI server `.14` chưa có Node/Codex/OpenCode trong PATH; không cài thêm vào host.

- Codex CLI kết nối 9Router và trả event JSON, exit 0 nhưng **không tạo file**; model báo môi trường read-only. Log còn cảnh báo metadata alias không tồn tại và helper dưới TEMP. Chưa xác định nguyên nhân cuối cùng, không coi là coding pass.
- OpenCode lần thử chỉ cấp edit không thể sửa do thiếu read. Sau khi cho read + edit trong thư mục tạm, đã đọc `BEFORE` rồi sửa thật thành `ASF_CLI_OK\n`: **exit 0, artifact đúng, ~10.29 s**.
- Chốt OpenCode cho adapter coding MVP; giữ Codex adapter tùy chọn sau khi qua cùng bài kiểm tra. Probe Windows chưa thay thế S7 sandbox Linux.

Nguồn OpenAI Docs đã đọc để đối chiếu: [non-interactive mode](https://developers.openai.com/codex/noninteractive/), [configuration reference](https://developers.openai.com/codex/config-reference/). Codex custom provider dùng Responses; JSON event stream không thay thế kiểm tra file/test.

## 6. DNS, TLS, Caddy, NetBird

- CA [caddy-root.crt](../caddy-root.crt) có SHA-256 `364fc6615c952a558360a13f8cf09fa991d87792b5bec91e69952de5c3643aa4`, **khớp file trên Caddy**. Đây là chứng chỉ công khai, không phải private key.
- Windows dùng CA chỉ định cho GitLab/9Router HTTPS thành công. `.14` tin Caddy CA ở system store, curl GitLab 200 và 9Router health OK.
- Probe container tạm `node:22-alpine` trên `.14`, dùng image đã có (`--pull=never`), read-only filesystem, không capabilities, không Docker socket, mount duy nhất CA công khai: HTTPS GitLab/9Router đều 200. Container tự xóa khi hoàn tất. Kết quả chỉ chứng minh DNS/trust từ container khi nạp CA, không chứng minh CI/coding sandbox đã nghiệm thu.
- `.13` không resolve hostname `.local` bằng `getent`/`resolvectl`, dù `dig @192.168.1.50 gitlab.lazy.local` trả đúng `.51`; có DNS `.50` và `1.1.1.1`. Khi ép DNS bằng `curl --resolve`, TLS vẫn thất bại vì chưa tin CA; `/etc/gitlab/trusted-certs` và local CA store rỗng. **Cần sửa cả DNS lẫn trust**, gồm trust của GitLab Ruby/Omnibus, trước webhook/Registry.
- `.local` có thể bị mDNS xử lý khác DNS unicast. MVP giữ naming hiện có, cấu hình DNS routing tường minh và thử từ host/container; về lâu dài cân nhắc `home.arpa` hoặc split DNS domain sở hữu.
- OpenProject public DNS qua Cloudflare; MCP public có lúc thành công, có lúc TLS handshake timeout. Dùng riêng CA Caddy cho public URL sẽ loại CA công cộng và gây lỗi trust.
- `openproject.lazy.local` qua Caddy có cert hợp lệ nhưng backend trả 400 `Invalid host_name configuration`; OpenProject canonical hostname là `openproject.lazy247.space`, additional hostname chỉ có `web`.
- Đã đọc MCP ổn định qua SSH local forwarding tới `.12` loopback 8080, giữ Host canonical và X-Forwarded-Proto=https; không đổi server. Đây là tuyến khảo sát, không đưa SSH tunnel quản trị vào runtime.
- Caddy đang có route GitLab, OpenProject local, AI gateway, Portainer, Proxmox/AdGuard/NAS, NetBird, LiveKit và `.51:18081 → .14:18080`. Không ghi đè các route đó.
- Snippet `internal_only` tồn tại nhưng **GitLab, OpenProject local và AI gateway chưa import snippet này**. Với cấu hình forward 80/443 được ghi trong Caddyfile, cần rà lại truy cập ngoài LAN; không kết luận chỉ có NetBird bảo vệ các hostname này.
- Route NetBird quản lý/relay trỏ `.54:8080/8081`. Các host được khảo sát không có NetBird CLI; điều này phù hợp mô hình subnet router. LAN SSH thông không chứng minh ACL, DNS hay truy cập từ client NetBird từ xa đã đúng. Chưa có quyền management NetBird/AdGuard để đọc policy.
- Các tên `asf.lazy.local`, `asf-api.lazy.local`, `helpdesk-staging.lazy.local` chưa resolve trên máy khảo sát.

## 7. Mức hoàn thành spike Phase 0

| Spike | Hiện trạng sau khảo sát | Điều kiện còn lại |
|---|---|---|
| S1 Gateway | **Pass một model**: chat/schema/tool call/usage | Chốt quota và thử các profile nếu dùng model khác |
| S2 OpenProject | Read-only MCP pass, workflow/binding đã đọc | Bot giới hạn quyền; tạo/update/comment/relation/đọc lại trong project ASF |
| S3 GitLab | Web/SSH topology, project và runner inventory xác minh | Bot tạo branch/commit/MR thật trong repo mới |
| S4 Runner | Online nhưng shell, có quyền Docker host | Runner CI VM cô lập; pipeline JUnit pass |
| S5 Staging | Có host và port có thể quy hoạch | Hello-world qua CI + DNS/Caddy mới + smoke |
| S6 Webhook | GitLab cho local webhook; DNS/CA `.13` đã sửa sau khảo sát | Xác thực webhook thật; test delivery/idempotency |
| S7 Coding | OpenCode file edit thật pass trên Windows | Chạy trong container Linux không socket/privileged; diff và test pass |

Không có thao tác tạo project/repo/service account, commit/push, bật Registry, prune, đổi DNS hay reload Caddy trong khảo sát. Các bước này được sắp thứ tự ở kế hoạch triển khai.
