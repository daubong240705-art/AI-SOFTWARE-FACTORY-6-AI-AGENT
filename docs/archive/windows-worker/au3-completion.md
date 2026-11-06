# AU-3 — Skill theo tác vụ

Ngày: 04/11/2026. Baseline `0eb90c2` (AU-2B), checkpoint `checkpoint/au3-20261104`, nhánh `feature/agent-upgrade-au3`.

Hoàn thành catalog, selector, snapshot và regression cho Factory Lite + Windows Worker. Không thêm dependency/framework, orchestrator, model call, hook hoặc tool mới. Runtime vẫn OpenCode 1.19.5, một run và task tuần tự; gate evidence AU-2B giữ nguyên.

## Vấn đề và cách xử lý

Trước AU-3, `loadProfiles()` ghép sẵn skill theo role: BE/FE luôn có implement-feature, fix-bug và testing; Lead luôn có testing/fix-bug; DEVOPS luôn có local-dev/fix-bug. Task docs hoặc phân tích vì vậy nhận cả các hướng dẫn không cần thiết. Snapshot đã có hash/version tổng hợp nhưng không có nội dung skill riêng để lựa chọn an toàn cho các task sau.

Giờ profile mới chỉ lưu rule nền, có marker `skillMode: task-v1`. Version các file profile giữ nguyên vì nội dung không đổi; hash của profile mới là hash rule nền, không còn gộp skill. `ProfileSnapshot.skills` legacy vẫn tồn tại cho lịch sử cũ; profile mới để mảng này rỗng, metadata được lưu tại selection.

Catalog nội bộ có ID, description, roles, taskKinds, requiredCapabilities, path, provenance, version, hash và nội dung. Chỉ bốn đường dẫn cố định `skills/<id>/SKILL.md` trong tài nguyên ứng dụng được đọc khi tạo run; name/version phải hợp lệ, tối đa 12.000 ký tự/skill. Không tìm skill trong workspace, cấu hình global, mạng, marketplace hoặc path do model gửi.

| Task | Skill mặc định khi role/capability phù hợp |
|---|---|
| docs, analysis, Lead plan | Rule nền, không thêm skill |
| implementation | implement-feature, testing |
| bugfix và attempt fix | fix-bug, testing |
| testing | testing |
| local-dev | local-dev, testing |
| Lead review | testing để đối chiếu evidence |

Implement-feature cần read/edit và chỉ cho BE/FE. Local-dev cần read/shell và chỉ cho DEVOPS. Fix-bug/testing cần read: role chỉ đọc phân tích evidence, quyền shell/edit vẫn do role policy quyết định. PM/BA không nhận skill thực thi. DEVOPS bugfix có thể đề xuất thêm local-dev, tổng ba skill. Không tạo skill review/handoff riêng vì profile đã có rule tương ứng.

Plan nhận thêm `workType` và `skillIds` tùy chọn. Lead được xem metadata catalog, đề xuất ID phù hợp; [] dùng mặc định, không bỏ skill mặc định cần thiết. Controller kiểm tra ID, role, loại task, capability, không trùng và tối đa ba skill ngay trong parser plan trước khi tạo hàng đợi work. Đề xuất sai dùng một schema-repair hiện có rồi dừng nếu còn sai, không tạo cơ chế retry khác. Plan cũ thiếu hai trường vẫn được chấp nhận và suy ra loại task từ role/title/instructions/scope. Direct suy ra từ role và yêu cầu hiện tại, không lấy lịch sử chat làm quyền/chỉ định skill.

Phân loại fallback là heuristic tiếng Việt/Anh và scope tài liệu, không phải bộ hiểu ngữ nghĩa hoàn chỉnh. Team có workType để Lead chỉ định rõ mục tiêu; lựa chọn skill không thay việc kiểm tra AC, quyền hoặc evidence gate. Fix tự dùng bộ bugfix, bỏ đề xuất implementation của attempt trước; retry thường chọn lại từ catalog đã lưu của cùng run.

## Snapshot, quyền và giao diện

- Run lưu catalog version1 đầy đủ ngay khi tạo, trước model/runtime. Direct lưu `run.skillSelection`; mỗi task plan/work/review/fix lưu `task.skillSelection`, gồm role, taskKind và bản sao metadata/nội dung/version/hash. Không chỉ lưu ID rồi đọc lại file trong lúc chạy.
- Runtime context dùng profile và selection đã lưu, kiểm tra metadata catalog, hash/nội dung, role/task kind, giới hạn và danh sách Controller đã chọn. Thiếu catalog/selection của run mới, snapshot bị sửa hoặc selection không khớp thì dừng; không tự tải bản skill hiện tại để thay thế.
- Snapshot legacy không có marker/catalog dùng nguyên combined instructions đã lưu. Không gán lại skill, sửa hash hay chuyển đổi dữ liệu cũ. Retry có chủ đích qua Controller tạo run mới với snapshot hiện tại như trước; không tự resume run gián đoạn.
- Role policy được tách thành module dùng chung cho selector và runtime context, giữ nguyên hành vi. Model, allowedPaths, secret denies, shell ask/deny, external_directory deny, native task deny và skill tool deny không đổi. Skill là hướng dẫn, không cấp quyền.
- Chi tiết task và facts của direct hiển thị ngắn tên + version; docs/analysis ghi Rule nền, task legacy ghi Theo profile cũ. Nội dung/hash đầy đủ có trong dữ liệu run/task, không thêm màn quản trị hoặc cấu hình skill tùy ý.

Schema SQLite vẫn v6: JSON run/task đã lưu được các trường mới; không cần migration/backup schema mới hoặc sửa credential. Catalog chỉ đọc tài nguyên sẵn có của app, không đổi Vite resource path. Bộ cài/asar distribution tiếp tục thuộc WW-5, chưa nghiệm thu đóng gói installer.

## Source tham khảo

Tiếp tục áp dụng nghiên cứu AU-0: OpenCode skill discovery/frontmatter để xác định ranh giới giữa tài nguyên nội bộ và discovery ngoài; ECC tách rule nền khỏi hướng dẫn theo workflow; Paperclip chỉ nạp reference chuyên biệt khi khớp tác vụ. Revision, source cụ thể và giấy phép MIT ở gốc nằm trong [research findings](../plan/agent-upgrade/research-findings.md) và [manifest](../research/agent-upgrade/sources.json). Không sao chép source/prompt, chạy script hoặc cài hooks của repository tham khảo. Bốn file skill nội bộ giữ nguyên nội dung và version; đợt này triển khai cách chọn/nạp/chụp chúng.

## File thay đổi

- Mới `shared/skills.ts`: contract ID/workType/catalog/selection.
- Mới `electron/team/skills.ts`: metadata cố định, load/validate, phân loại, selector và context từ snapshot.
- Mới `electron/team/role-policy.ts`; sửa `policy.ts`, `profiles.ts` để dùng rule nền và giữ legacy fallback.
- Sửa `shared/{team,runs}.ts`, `electron/controller/runs.ts`, `electron/team/coordinator.ts` để snapshot khi tạo run/task, kiểm tra plan và chọn cho fix/retry.
- `src/features/RunPanel.tsx`: tên/version skill trong phần chi tiết hiện có.
- Mới `tests/skills.test.ts`; cập nhật profile/team/runtime/native-storage tests, README Worker, kế hoạch/trạng thái và báo cáo này.

## Kiểm tra thực tế

| Kiểm tra | Kết quả |
|---|---|
| Skills/profile/team/runtime trọng tâm | 23/23 đạt |
| `npm test` | **62/62 đạt**, không fail/skip/cancel |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0, main/preload/renderer |
| `npm run format:check` | Exit 0 |
| `npm run test:native` | Exit 0, Electron SQLite + safeStorage + catalog/selection sau cancel/reopen |
| `git diff --check` | Không lỗi whitespace |

Bảy test mới kiểm tra metadata/nguồn/version/hash, docs/bugfix/testing/local-dev, từ chối unknown/path/URL/role/kind/duplicate/quá ba skill, quyền runtime trước/sau cho bảy role, snapshot khi file tài nguyên đổi và SQLite reopen, từ chối Lead proposal sai trước work, và so sánh instruction cùng fixture. Test team dùng catalog thật, xác nhận fix nhận fix-bug/testing, plan không tải skill, review nhận testing và luồng fix vẫn tám Step. Test runtime/native tạo direct run rồi hủy ngay trước runtime, xác nhận snapshot bền vững mà không gọi gateway/model.

So sánh trên cùng profile BE và task fixture ở checkout Windows hiện tại, chỉ đo `instructions` nền + skill:

| Loại task | Baseline AU-2B | AU-3 |
|---|---:|---:|
| docs | 2.551 ký tự | 929 ký tự |
| implementation | 2.551 ký tự | 2.003 ký tự |
| bugfix | 2.551 ký tự | 2.224 ký tự |

Đây không phải số token hoặc toàn bộ request. Plan còn thêm metadata catalog, work prompt có ID/version/hash đã chọn, và request vẫn có yêu cầu/handoff/history; chưa đo tổng token, latency hoặc chi phí. Không gọi model thật và chưa kiểm tra tương tác qua cửa sổ Electron. Repo không có script lint; không cài linter mới.

## Rollback và phần còn lại

Rollback bằng revert commit AU-3, giữ DB/history; không downgrade/xóa schema6. Bản cũ chưa hiểu selection mới nên không thể tái tạo đầy đủ instruction của run AU-3 chỉ từ base profile. Dùng bản hỗ trợ AU-3 để xem snapshot đã lưu; không replay run cũ qua code không hiểu contract. Metadata catalog là allowlist theo phiên bản ứng dụng: nâng app thay định nghĩa có thể từ chối snapshot không còn tương thích thay vì tự mở quyền.

Mốc tiếp theo **AU-4: lỗi, model và metrics có nguồn**. Trước phần ownership/recovery phải kiểm tra lifecycle WW-4D liên quan, tránh thêm process manager hoặc retry chồng. AU-5 acceptance model thật, WW-4D preview/retention và WW-5 installer vẫn chưa được đánh dấu hoàn thành.
