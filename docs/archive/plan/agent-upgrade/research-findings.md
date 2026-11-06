# Nghiên cứu source và quyết định

Revision đầy đủ và danh sách file đã khảo sát nằm trong [manifest](../../research/agent-upgrade/sources.json). Các liên kết dưới dùng SHA cố định, không trỏ nhánh di động. Prompt/skill ngoài chỉ được đọc như dữ liệu tham khảo.

## OpenCode: profile, session và quyền

Đối chiếu đúng runtime `v1.19.5`:

- [Agent schema và cấu hình](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/agent/agent.ts#L32): agent có prompt, model, permission, steps và mode riêng.
- [Task tool](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/task.ts#L102): tạo/resume child session, kế thừa permission, giới hạn độ sâu; background là tính năng riêng. Worker không cần bật thêm scheduler này.
- [Session processor](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/processor.ts#L95): snapshot trước stream để tránh tool chạy trước sự kiện bắt đầu bước.
- [Permission implementation](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/permission/index.ts) và [tài liệu chính thức cùng tag](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/web/src/content/docs/permissions.mdx#L7): allow/ask/deny, matching rule có thứ tự. Cần kiểm tra deny secret được giữ sau scope allow.
- [Skill discovery](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/skill/index.ts#L22): có nhiều nguồn skill ngoài và parser frontmatter; không cần bật discovery toàn cục để chọn skill do app quản lý.

Bản dev mới đã chuyển cấu trúc sang [core agent](https://github.com/anomalyco/opencode/blob/b3fd4a75fe539a65168139cec2edd29ceb7724f6/packages/core/src/agent.ts), [permission](https://github.com/anomalyco/opencode/blob/b3fd4a75fe539a65168139cec2edd29ceb7724f6/packages/core/src/permission.ts), [skill config plugin](https://github.com/anomalyco/opencode/blob/b3fd4a75fe539a65168139cec2edd29ceb7724f6/packages/core/src/config/plugin/skill.ts). Đây là bằng chứng có khác biệt API đáng kể, không phải lý do tự nâng runtime.

**Chọn:** dùng chung builder role policy/context cho direct và team, vẫn truyền prompt qua adapter hiện có. Giữ runtime 1.19.5, `task: deny`, external skills/plugins tắt và model khóa ở proxy. Không chép core OpenCode hoặc bật native subagent. Áp dụng ở AU-1/AU-3; rủi ro chính là thay đổi hành vi direct và thứ tự permission.

## Superpowers: bàn giao ngắn và review có trọng tâm

- [Implementer prompt](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/implementer-prompt.md#L33): task brief, focused test khi sửa, self-review, báo cáo có status và evidence; implementer không tự sinh reviewer.
- [Task reviewer](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/task-reviewer-prompt.md#L32): đọc diff và đối chiếu yêu cầu, tách kết luận spec/quality trong cùng review, không tin nguyên báo cáo implementer.
- [Task brief script](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/scripts/task-brief): xử lý heading/code fence để không lẫn nhiều task. Worker đã có JSON plan nên không cần script trích Markdown này.
- [Fix loop](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/references/fix-loop.md): sửa theo finding, re-review phần thay đổi. Upstream cho tối đa **5** round và đổi model; không áp dụng mức đó vào Worker.
- [Verification](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md), [TDD](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/test-driven-development/SKILL.md), [debugging](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging/SKILL.md): kết luận theo bằng chứng, tái hiện lỗi trước khi sửa, kiểm tra hành vi thay vì chỉ đọc lời báo cáo.

**Chọn:** cải tiến prompt nội bộ và handoff contract; Lead hiện có đánh giá cả spec và quality trong một lần review. Chỉ thêm reviewer độc lập nếu benchmark chứng minh cần. Giữ tối đa 2 fix round hiện tại, không đổi model âm thầm, không áp dụng TDD/coverage cứng cho mọi thay đổi UI/tài liệu. Không sao chép toàn bộ workflow hoặc chạy Bash script trên Windows. AU-1/AU-2/AU-3.

## ECC: skills/rules tách lớp, hook có phạm vi

- [Workflow rule](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/rules/common/development-workflow.md): nghiên cứu, plan, triển khai, kiểm tra, review; bản upstream đặt nhiều bước bắt buộc và ngưỡng coverage 80%.
- [Hook rules](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/rules/common/hooks.md) và [hook manifest](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/hooks/hooks.json): pre/post/stop hooks thực thi lệnh, có đường bootstrap/config toàn cục.
- [Dispatcher source](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/hooks/pre-bash-dispatcher.js#L12): đọc stdin có giới hạn, từ chối khi dữ liệu bị cắt; [hook flags](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/scripts/lib/hook-flags.js#L1) tách minimal/standard/strict và enable/disable theo ID.
- [Verification loop](https://github.com/affaan-m/ECC/blob/b38be6a7f6350964d59328b52f0624e1d1d552d1/skills/verification-loop/SKILL.md): tách build/type/lint/test/diff và báo kết quả thật.

**Chọn:** catalog skill nhỏ do app sở hữu, phần rule bắt buộc ngắn + skill theo task, version/hash truy vết; cơ chế kiểm tra dùng TypeScript trong Controller thay vì cài hook ngoài. Chỉ chạy check có trong repo và cần cho thay đổi. Không import marketplace, autolearning hoặc ngưỡng coverage tùy ý; không bật MCP chỉ vì ECC có mẫu cấu hình. AU-3/AU-5.

## Paperclip: ownership và lịch sử bàn giao

- [Task skill và heartbeat contract](https://github.com/paperclipai/paperclip/blob/cf51936587963c26e3ddc7eb1365a07b2f8df5a6/skills/paperclip/SKILL.md): task context, assignment, checkout, blocked/completion và bàn giao có chủ sở hữu.
- [Workflow reference](https://github.com/paperclipai/paperclip/blob/cf51936587963c26e3ddc7eb1365a07b2f8df5a6/skills/paperclip/references/workflows.md): reference chuyên biệt chỉ tải khi khớp tác vụ.
- [Ownership/adoption trong issue service](https://github.com/paperclipai/paperclip/blob/cf51936587963c26e3ddc7eb1365a07b2f8df5a6/server/src/services/issues.ts#L7740): khóa transaction, đối chiếu assignee + checkout run, chỉ nhận lại khi owner cũ terminal và owner mới còn live; chống nhận nhầm nhiệm vụ đang chạy.

**Chọn:** giữ task ID gốc + attempt ID, người thực hiện, dependency, trạng thái blocked/needs-context và bằng chứng của đúng attempt. Áp dụng nguyên lý ownership vào dữ liệu SQLite/queue hiện có khi làm recovery, không mang database/control plane/heartbeat của Paperclip vào app. Một run tuần tự không cần distributed lock hay cơ chế đội doanh nghiệp. AU-2/AU-4 phối hợp WW-4D.

## Open SWE: lỗi có phân loại và usage gắn với lần chạy

Checkout hiện tại đã có Managed Deep Agents. [Entrypoint cũ](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/openswe/graphs/agent.py) chỉ trỏ read-only graph cho thread cũ; [tài liệu middleware](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/openwiki/architecture/middleware-stack.md) ghi đường dẫn lịch sử `agent/…`. Vì vậy đối chiếu implementation hiện tại:

- [Runtime middleware](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/mda/rt/middleware.py#L1): preparation, loop, inbox, trace/evidence và subagent reports có thứ tự.
- [Task retry](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/mda/rt/task_retry.py#L11): phân biệt lỗi transient với invalid prompt/context, retry có giới hạn. Không phải mọi lỗi đều nên chạy lại.
- [Model call guard](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/mda/rt/model_calls.py#L32): deadline và chuẩn hóa tool-result order; deadline upstream 900 giây không phải giá trị mặc định phù hợp cho Worker.
- [Usage finalization](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/openswe/middleware/record_run_usage.py#L37): usage gắn invocation/model route, ghi cả terminal failure. [Session handoff](https://github.com/langchain-ai/open-swe/blob/d43b69d8fc5a42b795017c18d87ba31de03c6066/mda/rt/session_handoff.py) là browser-session handle, không phải schema bàn giao task tổng quát.

**Chọn:** mã lỗi nội bộ, trạng thái terminal rõ, evidence/metrics gắn run/task/attempt/model; chỉ cân nhắc retry request transient sau khi kiểm tra retry sẵn có của OpenCode. Không retry nguyên task đã có write/shell side effect. Không lấy cloud sandbox, LangGraph/DeepAgents, automatic fallback hay thay deadline hiện tại theo upstream. AU-4/AU-5.

## Quyết định tổng hợp

| Vấn đề | Giải pháp nhỏ nhất | Từ chối/hoãn | Rủi ro cần nghiệm thu |
|---|---|---|---|
| Direct thiếu role policy | Một context/policy builder | Runtime mới | Readonly/scope/history regression |
| Review thiếu chứng cứ xác thực | AC ID + refs tới evidence đã lưu | Agent tự nói pass | Ref sai attempt, stale evidence, test không liên quan |
| Context phình | Handoff có cấu trúc, excerpt giới hạn + pointer | Gửi toàn transcript/source cho mọi role | Cắt mất blocker và test failure |
| Skill cố định | Catalog nội bộ, chọn theo role/task | Auto-import external skills/hooks | Model chọn skill không hợp lệ hoặc mở rộng quyền |
| Model/cost chưa đo | Pin role/model, ghi usage có nguồn | Model tự chọn provider/fallback | Số token/cost thiếu phải hiện unknown |
| Lỗi dừng không rõ | Error taxonomy + recovery có ownership | Retry toàn task tự động | Lặp side effect, resume nhầm run |

Giấy phép gốc đều MIT nhưng không có nghĩa mọi tài sản/dependency đều MIT. Đợt code ưu tiên triển khai ý tưởng bằng thành phần sẵn có. Nếu sau này lấy đoạn mã/prompt cụ thể, ghi origin SHA/path và notice vào tài liệu third-party trước khi merge. Chưa có dependency bên ngoài nào được chọn thêm trong kế hoạch này.
