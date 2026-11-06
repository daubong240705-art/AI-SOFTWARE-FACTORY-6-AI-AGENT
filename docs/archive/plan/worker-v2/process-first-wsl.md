# Quy trình mới — Lead linh hoạt, WSL2 làm môi trường thực thi chính

> **Đầu mối hiện hành:** [Factory V2](../../../../plan/factory-v2/README.md) hợp nhất hướng WSL2/quyền tự động của tài liệu này. Điều hướng, palette/font và thứ tự triển khai theo [UI chín ảnh](../../../../plan/factory-v2/design-reference.md) và [F0–F8](../../../../plan/factory-v2/delivery-plan.md), thay đề xuất giản lược tab ở mục 10 bên dưới.

Ngày: 05/11/2026. Trạng thái: **đề xuất thay định hướng kiến trúc; chưa cài đặt/migrate/triển khai**. Yêu cầu mới của người dùng: không bị ràng buộc kiến trúc Worker hiện tại; thiết kế quy trình hợp lý, ít gián đoạn, linh hoạt agent và tự động hóa.

**Ưu tiên tài liệu:** tài liệu này và [lộ trình mới](process-first-roadmap.md) thay các quyết định bắt buộc Windows-native/Electron, giữ nguyên controller/schema và thứ tự V2-01–07 trong kế hoạch trước. Ma trận nghiệp vụ [Loops](loops-parity.md), [automation semantics](automations.md) và các nhu cầu [đa lĩnh vực](multidomain.md) tiếp tục là đầu vào chức năng; không bắt triển khai mọi thành phần cũ hoặc nhập toàn bộ Paperclip. Đây không phải yêu cầu xóa source/dữ liệu cũ.

## 1. Hai loại chấp nhận khác nhau

| Loại | Ví dụ | Cách xử lý đề xuất |
|---|---|---|
| Quyền thực thi công cụ | Đọc source/file, tìm kiếm, sửa file, chạy Bash/build/test/FFmpeg | Cấp trước theo project/environment; không hỏi từng thao tác thường ngày |
| Quyết định nghiệp vụ | Chọn hướng thiết kế ảnh hưởng sản phẩm, xác định đối tượng video, ngân sách, mục tiêu mâu thuẫn | Lead hỏi khi không thể suy ra hợp lý; hỏi một lần có ngữ cảnh/khuyến nghị |
| Review kết quả | Người dùng muốn xem bản nháp trước xuất cuối hoặc review ticket cuối | Theo chế độ dự án; không biến mọi task nội bộ thành gate |

Quyết định nghiệp vụ không mặc định cần nút Approve. Người dùng có thể trả lời trong Chat; Host ghi quyết định và liên kết phần việc bị ảnh hưởng. Chỉ dùng decision card khi có lựa chọn cụ thể hoặc cần quyết định có phiên bản. Một việc vừa được giao và nằm trong phạm vi đã cấp không phải xin phép lại để “bắt đầu làm”.

Không hiển thị hàng trăm tool approval trong Cần xử lý. Runtime permission failure được gom thành vấn đề cấu hình đúng connection/project, có lý do và hướng sửa; dừng phần việc liên quan, không tự click Accept giả hoặc lặp lại lệnh thất bại để tạo thêm prompt.

### Khi nào Lead tự quyết?

- Đã có mục tiêu/phạm vi và quyền: làm ngay, tự chọn các chi tiết thông thường.
- Có nhiều cách nhưng thay đổi dễ đảo và không ảnh hưởng đáng kể: chọn cách phù hợp nhất, ghi giả định ngắn rồi tiếp tục.
- Có quyết định ảnh hưởng đáng kể mà ngữ cảnh chưa đủ: hỏi tối thiểu phần đó; các nhánh độc lập vẫn chạy.
- Chưa có quyền cho hành động mới như publish, mua dịch vụ hoặc ghi ra vùng ngoài scope: cần cấp quyền cấp hành động/project, không hỏi lại mỗi câu lệnh phục vụ cùng hành động đã cấp.

Không dùng sự tự tin model làm tiêu chí duy nhất cho quyền hoặc kết luận kết quả; quyền là cấu hình host, chất lượng là evidence/review theo đầu ra.

## 2. Vì sao WSL2 phù hợp, và điều nó không tự giải quyết

WSL2 cho các runtime chạy trong một môi trường Linux với Bash, Git, Node/Python và toolchain nhất quán. Điều này giảm các nhánh PowerShell/Git Bash/path quoting và giúp nhiều tool repo dùng được trực tiếp. Đây là lợi ích môi trường, không phải bảo đảm mọi lệnh/model chạy nhanh hoặc đúng hơn.

Các tài liệu chính thức đã đối chiếu:

- [OpenAI Docs: approvals/security](https://learn.chatgpt.com/docs/agent-approvals-security): sandbox và approval policy là hai cấu hình riêng; không hỏi không đồng nghĩa được phép mọi thao tác. Codex chạy trong WSL2 dùng Linux sandbox.
- [OpenAI Docs: WSL](https://learn.chatgpt.com/docs/windows/wsl): môi trường/cài đặt CLI trong distro; repo Linux phù hợp workflow Linux.
- [Claude setup](https://code.claude.com/docs/en/setup), [permissions](https://code.claude.com/docs/en/permissions): WSL2 và permissions là các lựa chọn riêng; các mode auto/dontAsk/bypass không đồng nghĩa hoặc có cùng ngoại lệ.
- [OpenCode WSL](https://opencode.ai/docs/windows-wsl/), [permissions](https://opencode.ai/docs/permissions/): có hướng WSL và permission config riêng.
- [Microsoft filesystem guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems): ưu tiên Linux filesystem khi toolchain chạy Linux; không mặc định làm trực tiếp trong `/mnt/e/...`.

WSL không tự tắt tool prompts, bỏ quyền Linux, cung cấp sudo, cài runtime hay đăng nhập tài khoản. Windows CLI đã cài không chứng minh Linux CLI có sẵn. Không hứa app dựng video Windows chạy trong Linux; nếu cần Premiere/DaVinci/native GUI thì có Windows tool bridge phù hợp được triển khai riêng. GPU/encoder và dịch vụ LAN cần probe thực tế.

Trạng thái máy chỉ mới đọc bằng `wsl --status` / `wsl --list --verbose`: Ubuntu là distro mặc định, version 2, đang Stopped; docker-desktop cũng đang Stopped. Chưa khởi động distro, kiểm tra version Ubuntu, packages, auth, network, disk hay chạy model trong WSL.

## 3. Môi trường đề xuất

```text
Trình duyệt Windows
       │ local authenticated API + event stream
       ▼
Ứng dụng Host trong Ubuntu/WSL2
  ├─ Project, đội, Chat, công việc, decisions, outputs
  ├─ Một coordinator + durable queue + automation evaluator
  ├─ Runtime adapters: Codex / Claude Code / OpenCode
  ├─ Tool/job runners: MCP / CLI / render / data processing
  └─ SQLite + asset files + workspaces trong Linux filesystem
       │
       └─ Windows tool bridge khi cần native apps (phạm vi sau)
```

**Khuyến nghị khởi đầu:** web UI + local Host trong WSL2. Không bắt Electron; desktop wrapper là lựa chọn đóng gói sau. Cũng không bắt Docker/Kubernetes/database server ở bản đầu. Runtime integrations dùng protocol chính thức thay vì gõ chữ vào terminal và đoán kết quả, trừ công cụ chỉ có terminal thì adapter phải biểu thị đúng giới hạn.

SQLite, artifact storage và workspace có authority ở Linux; không có hai DB writable trên Windows và WSL. Repo làm việc đề xuất `~/factory/projects/<project>`, app data riêng trong Linux home. Cài toolchain Linux riêng; không dùng chung `node_modules` Windows/Linux. Windows xem file qua đường hỗ trợ hoặc IDE Remote WSL; media lớn trên ổ Windows có thể dùng binding/import được kiểm tra, không cần copy mọi file vô điều kiện.

Host bind loopback mặc định, có session/token local và origin validation; không cho mọi website truy cập API thực thi chỉ vì địa chỉ localhost. Truy cập NetBird/LAN sau đó thêm cấu hình host/auth/TLS phù hợp, không tự bind `0.0.0.0` hoặc coi NetBird là thay thế quyền ứng dụng. Không ghi credentials trực tiếp vào workflow/DB export/log.

Đây là một service quản lý ứng dụng, không một “agent Lead thứ hai” chạy cạnh coordinator. Lead đề xuất/phân rã; coordinator kiểm quyền/ownership và dispatch. Workflow không có mô hình riêng cho từng runtime.

## 4. Quy trình trao đổi tự nhiên

```text
Trao đổi mục tiêu với Lead
       ↓
Lead hiểu ngữ cảnh và đánh giá việc cần thực hiện
       ├─ Câu hỏi/thảo luận → trả lời, lưu quyết định nếu cần
       ├─ Việc nhỏ → tự làm bằng runtime/tool phù hợp
       └─ Việc lớn → chia thành các phần có đầu ra, giao agent phù hợp
                          ↓
                Thực hiện / trao đổi / xử lý song song
                          ↓
                Kiểm tra theo loại kết quả, tự sửa có giới hạn
                          ↓
                Báo kết quả hoặc đưa bản nháp cần quyết định
                          ↓
                  Hoàn thành / tiếp tục theo phản hồi
```

Không bắt một cuộc trò chuyện phải tạo ticket, không ép mọi mục tiêu đi qua PM→BA→BE→FE→TEST→DEVOPS. Người dùng có thể giao một agent làm nhanh, yêu cầu lập plan trước, hoặc cho Lead tự tổ chức trong scope. Các bước sinh ra vì nhu cầu thực tế của công việc.

Task nội bộ do Lead ghi đủ để thực hiện: mục tiêu, owner, input/context, output/criteria, dependency khi có, quyền/tài nguyên cần. Người dùng không phải điền các trường đó thủ công; UI hiển thị ngắn gọn và mở chi tiết khi cần. Những việc chỉ trao đổi không bị biến thành task rác.

Lead có thể điều chỉnh kế hoạch khi phát hiện mới, ghi lý do và giữ liên kết phần đã làm. Chỉ thay đổi ảnh hưởng mục tiêu/phạm vi/quyền hoặc quyết định chưa đủ thông tin mới cần hỏi người dùng. Chỉnh kế hoạch không tự restart mọi task; task bị stale mới được đối chiếu/chuyển tiếp.

## 5. Đội linh hoạt, phân công vừa đủ

Agent là cấu hình có tên, hướng dẫn, runtime/model, skills/tools và policy; nhãn nghề nghiệp không quyết định quyền. Dự án có đội thường trực, agent dùng theo nhu cầu hoặc task agent ngắn hạn được tạo từ template trong quyền đã cấp.

Không tạo một agent cho từng bước hình thức; Lead được tự làm khi đơn giản. Phân công khi có chuyên môn/context/tool riêng hoặc phần việc độc lập có lợi khi chạy song song. Concurrency theo tài nguyên/quota/workspace conflicts, không hardcode chỉ hai role được chạy cùng lúc.

Subagents native của runtime không bị cấm theo nguyên tắc kiến trúc cũ. Chỉ bật khi adapter có thể quy chúng về task/run, theo dõi process/session/budget và dừng được theo ownership phù hợp. Nếu runtime không cung cấp visibility/control đủ, không quảng cáo child state giả; dùng coordinator-managed agents cho phần cần quản lý. Native child không được tự bypass task grants hay tạo scheduler cạnh tranh.

Model/runtime thay đổi được cho lượt mới. Session resume vẫn theo ràng buộc runtime/provider; chuyển công cụ tạo run mới với context bàn giao, không giả có thể chuyển nguyên session Codex sang Claude. Không tự đổi sang model tốn tiền hơn khi quota cạn nếu project chưa cấp policy fallback đó.

## 6. Quyền tự động cấu hình một lần

Mỗi project/environment có execution profile: paths, tools, network, package/cache directories, allowed actions và budgets. Profile cần đủ dùng cho công việc thực tế; cấp quyền ghi source nhưng khóa toàn bộ cache/build directories sẽ vẫn gây lỗi vô ích.

Mặc định mục tiêu trải nghiệm là các thao tác trong scope sau **không yêu cầu click**: đọc/tìm file, xem source, sửa file được giao, chạy shell/build/tests, chạy job/tool đã enabled. Host/adapter preflight xác minh mode thực tế và config precedence trước execution, không đợi hàng trăm lần gọi tool mới thấy đang ask.

Ba tầng kiểm tra phải thống nhất:

1. Host grants/policy.
2. Runtime config và managed settings của Codex/Claude/OpenCode.
3. Filesystem/network/OS hoặc container boundaries thực tế.

Không hỏi không có nghĩa mọi việc được chạy: thao tác không đủ quyền phải trả lỗi có cấu trúc. Nếu managed policy không cho profile cần thiết, hiển thị capability unsupported/needs-setup, không tự vượt quản trị. `never`/`dontAsk` có thể từ chối thay vì cho phép, nên phải kiểm tra lệnh thật có thành công.

Full access là profile tường minh. WSL2 một mình không cô lập toàn bộ Windows vì còn mounts/interop; nếu cần vùng thực thi mạnh hơn thì dùng project container/sandbox có mounts/quyền phù hợp. Không phát triển một command-prefix allowlist hàng trăm lệnh để thay cho boundary rõ ràng; một lệnh interpreter cũng có thể làm nhiều hành động.

Không mặc định root/passwordless sudo cho agent. Host provisioning là bước chuẩn bị có recipe và quyền riêng; thiếu tool runtime thì báo một blocker cấu hình, không xin sudo mỗi lần read/build. Các thao tác thay đổi credentials/hệ thống hoặc file ngoài scope không được suy ra từ quyền chỉnh source.

## 7. Quyết định và review không gây tắc việc

Decision record có câu hỏi, lựa chọn/khuyến nghị, context/phiên bản và phần việc đang chờ; trả lời trong Chat hoặc card đều ghi cùng record. Hỏi đúng vấn đề, không “bạn có chắc cho tôi tiếp tục?” lặp sau mỗi bước đã được giao.

Chế độ review chọn theo project/task:

- **Theo yêu cầu:** tự hoàn thành việc nội bộ sau kiểm chứng; hỏi khi thiếu quyết định hoặc khi người dùng muốn review.
- **Duyệt kết quả cuối:** tương thích nghiệp vụ Loops, người dùng nhận bản nháp/kết quả rồi Done/send-back.
- **Tự động theo tiêu chí:** đủ validators/evidence và quyền thì host kết luận; thiếu dữ kiện không tự gắn Passed.

Không bắt mọi project duyệt chiến lược, duyệt plan, duyệt tuyển agent và duyệt từng command. Plan-first chỉ khi người dùng chọn hoặc công việc thật sự cần quyết định đầu vào. Review không cần thiết không tạo một “công việc cần xử lý” chỉ để hoàn thiện hình thức workflow.

## 8. Giao tiếp, tiến độ và chống chạy lặp

Task thread là nơi bền vững để agent hỏi/đáp/bàn giao, với input/output refs; Chat người dùng chủ yếu với Lead. Native runtime messages được chuẩn hóa đủ để theo dõi, không ép mọi tool log thành lời hội thoại.

Các trạng thái quan sát tách rõ: agent sẵn sàng/đang làm/đang chờ/bị chặn; task trạng thái nghiệp vụ; job queued/running/terminal; decision pending/answered. Không dùng một badge “waiting” chung khiến người dùng không biết chờ ai/chờ gì.

Một coordinator authoritative, durable queue, run ownership/attempt fencing, message/action idempotency và artifacts bất biến vẫn cần để phối hợp tin cậy. Đây là nền đảm bảo, không phải biểu mẫu bắt người dùng thao tác. Mất kết nối sau một hành động không được tự replay; resume/reconcile có bằng chứng. Tự sửa bounded theo issue/budget, tránh vòng lặp làm đi làm lại không tiến triển.

## 9. Tự động hóa linh hoạt

Giữ mục tiêu List/Graph: event → condition → action; rule có trạng thái/version, thử bằng simulation, project/rule switches và history giải thích. Không bắt có automation graph mới làm được task đầu tiên.

Một sự kiện có thể giao agent, tạo task, chạy workflow/job hoặc cập nhật report theo policy. Schedule tạo cùng loại event với occurrence key, không orchestration engine riêng. AI phân loại là task có output riêng, không gọi model ẩn trong predicate mỗi event.

Agent có thể đề xuất hoặc cấu hình automation trong quyền đã cấp; những thay đổi routine hợp lệ tự áp dụng nếu user đã cho, không phải click mọi proposal. Thay quyền/publish/spend ngoài scope cần decision/grant đúng phạm vi. Rule không tự nâng quyền hay đóng human-final ticket.

Giữ bài toán Paperclip về mục tiêu/giao việc/ownership/chi phí và bài toán Loops về trải nghiệm ticket/review/automation. Không nhập cứng CEO hierarchy, vòng bảy role hay toàn bộ framework của sản phẩm tham khảo.

## 10. Trải nghiệm tối thiểu

Trang chính: ô trao đổi với Lead, việc đang diễn ra và việc thật sự cần người dùng trả lời. Dự án: Công việc / Trao đổi / Đầu ra / Tự động hóa. Đội và Extensions cấu hình theo nhu cầu, không checklist dài bắt buộc ngay từ đầu.

Hoạt động hiển thị mốc có ý nghĩa: ai đang làm gì, đầu ra nào mới có, blocker là gì. Command trace và raw events thu gọn. Cần xử lý không có “cho phép cat/rg/read file”; chỉ decision, review đã chọn hoặc blocker cần can thiệp.

## 11. Chuyển hướng từ bản hiện tại

Không bắt giữ Electron/controller/schema cũ; cũng không xóa chúng trước khi ứng dụng mới dùng được. Thực hiện dự án Host/UI mới trong workspace được phép, có nhánh/checkpoint và lát cắt end-to-end nhỏ. Reuse mã/assets nếu có ích, không kéo cả model fixed-role sang vì dễ làm.

Thiết lập môi trường Linux và thư mục làm việc mới tường minh; không tự di chuyển/xóa `E:\GIT\...`, DB AppData hoặc unregister distro. Chuyển dữ liệu bằng backup/export/import đã kiểm chứng trên bản sao; SQLite cũ dừng ghi hoặc backup nhất quán, không chia sẻ DB WAL writable qua hai OS. Chuyển credentials bằng cấu hình/auth refs của host đích, không copy thô toàn bộ home.

Đầu ra đầu tiên chứng minh quy trình mới: nói chuyện → giao việc có ngữ cảnh → runtime đọc/sửa/chạy kiểm tra mà không hỏi lệnh thường ngày → kết quả hiển thị → hỏi một quyết định nghiệp vụ khi thật sự thiếu. Không đợi hoàn thành toàn bộ ma trận Loops mới cho người dùng làm việc được.
