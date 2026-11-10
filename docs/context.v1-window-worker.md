
# NHIỆM VỤ: NGHIÊN CỨU CONTEXT ENGINEERING VÀ THIẾT KẾ PHƯƠNG ÁN TÍCH HỢP VÀO WINDOW-WORKER

## 1. Vai trò và mục tiêu

Bạn là Principal AI Systems Architect, chuyên nghiên cứu và thiết kế hệ thống AI Agent, Multi-Agent Orchestration, Context Engineering, Memory Architecture và Agent Harness.

Nhiệm vụ của bạn là nghiên cứu những phương pháp Context Engineering hiện đại, đặc biệt từ các bài chia sẻ tại **AI Native DevCon NYC 2026 (Tessl)**, sau đó khảo sát codebase của dự án `window-worker` để xây dựng phương án tích hợp khả thi.

**Mục tiêu cuối cùng:** Thiết kế một nền tảng quản lý context có khả năng phục vụ nhiều AI Agent và nhiều AI Team hoạt động song song, hỗ trợ chuyển giao công việc, duy trì tri thức dài hạn, giảm thất thoát ngữ cảnh và tối ưu chi phí token.

Không được mặc định rằng hệ thống cần một Context Manager tập trung. Hãy đánh giá cả các phương án tập trung, phân tán và hybrid trước khi đề xuất.

## 2. Nguyên tắc thực hiện

Toàn bộ nhiệm vụ thực hiện trong **Plan Mode – Research & Architecture Only**.

Quy định bắt buộc:

- Được phép đọc toàn bộ source code, tài liệu thiết kế, cấu hình và kế hoạch hiện có.
- Được phép tìm kiếm Internet, đọc tài liệu kỹ thuật, nghiên cứu GitHub và các hệ thống mã nguồn mở nếu công cụ hỗ trợ.
- Không chỉnh sửa source code hiện tại.
- Không cài đặt thư viện, package hoặc dependency.
- Không thực thi ứng dụng, script, migration hoặc test.
- Không tạo hoặc thay đổi database.
- Không triển khai bất kỳ tính năng nào trong giai đoạn nghiên cứu.
- Không tự ý thay đổi kiến trúc hoặc phạm vi dự án.
- Không mặc định các tính năng được mô tả trong tài liệu đã thực sự được triển khai.

Phân biệt rõ:

1. **Implemented:** Đã có trong codebase.
2. **Partial:** Đã triển khai một phần.
3. **Planned:** Chỉ xuất hiện trong tài liệu hoặc kế hoạch.
4. **Proposed:** Phương án mới do bạn đề xuất.

Mọi nhận định về hệ thống phải có bằng chứng từ source code, tài liệu hoặc cấu hình tương ứng.

Nếu không thể truy cập Internet hoặc không tìm được một bài chia sẻ cụ thể, phải nêu rõ giới hạn. Không được tự tạo nội dung rồi gán cho diễn giả.

---

# PHẦN I. NGHIÊN CỨU CONTEXT ENGINEERING

## 3. Nghiên cứu AI Native DevCon 2026

Nguồn bắt đầu:

https://tessl.io/devcon

Nghiên cứu chương trình hội nghị, bản ghi bài nói, slide, transcript, tài liệu liên quan và các bài viết của diễn giả nếu có.

Ưu tiên các chủ đề:

### 3.1. Context != Context: One Window, Different Lifecycles

Tác giả: Birgitta Boeckeler.

Tìm hiểu:

- Context là gì trong hệ thống AI Agent?
- Context Window khác Context Lifecycle như thế nào?
- Các loại context có vòng đời khác nhau ra sao?
- Thông tin nào nên tồn tại trong một task, một session hoặc toàn bộ project?
- Khi nào nên loại bỏ, nén hoặc tái tạo context?
- Cách ngăn context cũ ảnh hưởng đến quyết định mới.
- Phương pháp chuyển giao context giữa các phiên làm việc.
- Có nên tổ chức context theo task, agent, team hay project?

Đặc biệt phân tích khả năng ứng dụng khi một agent làm việc liên tục trong nhiều giờ hoặc khi task phải chuyển cho agent khác.

### 3.2. Engineering Context as a Graph

Tác giả: Alan Braun.

Nghiên cứu:

- Context Graph là gì?
- Khác biệt giữa Context Graph, Vector Database, Knowledge Graph và RAG.
- Các loại node và relationship có thể dùng.
- Cách liên kết requirement, task, source code, API, test, decision và artifact.
- Cơ chế truy xuất context theo quan hệ.
- Phương pháp cập nhật graph khi codebase thay đổi.
- Khả năng kết hợp graph retrieval với semantic search.
- Chi phí triển khai và vận hành.

Không mặc định Graph Database là bắt buộc.

Đánh giá khả năng triển khai graph bằng SQLite/PostgreSQL trước khi cân nhắc Neo4j hoặc hệ thống chuyên dụng.

### 3.3. Context, Subagents, MCP and Memory

Tác giả: Nicolas Carmont Zaragoza.

Nghiên cứu sự kết hợp giữa:

- Agent context.
- Subagent isolation.
- MCP tools.
- Persistent memory.
- Session memory.
- Task memory.
- Context handoff.
- Tool result management.

Trả lời những câu hỏi:

- Subagent nên nhận bao nhiêu context từ parent agent?
- Có nên chia sẻ toàn bộ lịch sử hội thoại?
- Context được chuyển giao theo hình thức nào?
- Agent có thể truy xuất memory của agent khác hay không?
- Memory nào cần được chia sẻ giữa các team?
- MCP nên đóng vai trò truy xuất context hay quản lý memory?
- Khi agent thay đổi model/provider, context và trạng thái công việc được duy trì như thế nào?

### 3.4. Context Drift

Nghiên cứu hiện tượng context drift trong các hệ thống coding agent và multi-agent.

Làm rõ:

- Nguyên nhân agent mất dần mục tiêu ban đầu.
- Tác động của context dài và nhiều thông tin không liên quan.
- Rủi ro khi tóm tắt context qua nhiều lần.
- Sự sai lệch trong chuỗi chuyển giao giữa các agent.
- Cách kiểm tra tính nhất quán với yêu cầu ban đầu.
- Cơ chế phát hiện và xử lý drift.

### 3.5. Memory Provenance và Reliability

Nghiên cứu:

- Memory provenance.
- Source attribution.
- Verified memory.
- Memory confidence.
- Memory versioning.
- Memory invalidation.
- Memory conflict resolution.
- Memory expiration.

Làm rõ cách ngăn agent biến các giả định chưa xác thực thành sự thật được lưu trữ lâu dài.

### 3.6. Agent Harness Engineering

Nghiên cứu mối liên hệ giữa Context Engineering và Agent Harness:

- Agent execution loop.
- Tool use policy.
- Context preparation.
- Environment state.
- Feedback loop.
- Evaluation.
- Recovery/checkpoint.
- Observability.

Đánh giá những thành phần nào nên thuộc Context Layer và thành phần nào nên thuộc Orchestration/Harness Layer.

## 4. Mở rộng nghiên cứu ngoài DevCon

Không giới hạn nghiên cứu trong các bài nói của hội nghị.

Tìm hiểu các phương pháp đã được công bố trong tài liệu kỹ thuật hoặc hệ thống thực tế, ưu tiên:

- Claude Code và Anthropic Agent SDK.
- OpenAI Codex.
- LangGraph và LangChain.
- Letta/MemGPT.
- Microsoft AutoGen.
- CrewAI.
- Các framework hỗ trợ memory, context retrieval và multi-agent orchestration khác nếu phù hợp.

Với mỗi công nghệ, xác định:

- Khả năng thực tế.
- Mô hình lưu trữ context.
- Phương thức tích hợp.
- Mức độ phụ thuộc framework.
- Khả năng chạy local.
- Khả năng thay đổi model/provider.
- Chi phí và độ phức tạp.
- Rủi ro lock-in.

Không đề xuất công nghệ chỉ vì phổ biến.

## 5. Yêu cầu đối với kết quả nghiên cứu

Tạo bảng tổng hợp:

| Phương pháp | Vấn đề giải quyết | Nguyên lý hoạt động | Bằng chứng/nguồn | Khả năng áp dụng | Độ phức tạp |
| -------------- | ---------------------- | ------------------------ | ------------------- | -------------------- | --------------- |

Phân loại rõ:

- Điều được diễn giả trình bày trực tiếp.
- Điều được xác nhận từ tài liệu chính thức.
- Diễn giải hoặc suy luận kỹ thuật.
- Đề xuất do bạn tự xây dựng.

Đối với mỗi phương pháp, đưa ra ví dụ thực tế trong một workflow có nhiều agent làm việc.

---

# PHẦN II. KHẢO SÁT WINDOW-WORKER HIỆN TẠI

## 6. Phân tích codebase

Khảo sát toàn bộ dự án `window-worker`.

Xác định:

### 6.1. Kiến trúc hệ thống

- Công nghệ backend/frontend.
- Process và worker model.
- Agent runtime.
- Cách quản lý session.
- Cách quản lý task.
- Cách lưu hội thoại.
- Cơ chế gọi AI model.
- Model/provider abstraction.
- Tool execution.
- Agent orchestration.
- Cơ chế lưu state.
- Cách quản lý file và workspace.

Trình bày sơ đồ kiến trúc hiện tại bằng Mermaid.

### 6.2. Context management hiện tại

Tìm kiếm tất cả thành phần liên quan:

- System prompt.
- Agent instruction.
- Session history.
- Message history.
- Tool call/result.
- Working memory.
- Persistent memory.
- Task state.
- Workspace state.
- File indexing.
- Context compression.
- Context summarization.
- Prompt construction.
- Token budgeting.

Với mỗi thành phần, xác định:

1. File/module chứa logic.
2. Chức năng thực tế.
3. Nơi lưu dữ liệu.
4. Vòng đời dữ liệu.
5. Các thành phần phụ thuộc.
6. Những hạn chế hiện tại.

### 6.3. Multi-Agent và Multi-Team

Kiểm tra hệ thống đã hỗ trợ những gì trong các khả năng:

- Agent độc lập.
- Parent/subagent.
- Agent hierarchy.
- Team organization.
- Task delegation.
- Cross-agent communication.
- Cross-team handoff.
- Concurrent execution.
- Distributed worker.
- Shared knowledge.
- Workflow checkpoint.
- Recovery sau khi worker bị gián đoạn.

Không nhầm lẫn giữa kế hoạch thiết kế với code đã hoàn thành.

### 6.4. Technical debt

Xác định những vấn đề ảnh hưởng trực tiếp đến việc bổ sung Context Engineering.

Đặc biệt:

- Coupling giữa agent và provider.
- Coupling giữa session và message history.
- Giới hạn khả năng lưu state.
- Khả năng mở rộng storage.
- Rủi ro mất dữ liệu.
- Rủi ro context không nhất quán.
- Race condition khi nhiều agent cập nhật memory.
- Khả năng thay đổi database.
- Khả năng tương thích ngược.

---

# PHẦN III. ĐỀ XUẤT KIẾN TRÚC CONTEXT ENGINEERING

## 7. Thiết kế các phương án

Xây dựng ít nhất ba phương án:

### Phương án A – Lightweight Context Management

Sử dụng tối đa hạ tầng hiện có.

Ưu tiên:

- Context package.
- Session/task state.
- Structured handoff.
- Context summarization.
- Token budget management.
- File-based hoặc SQLite storage.

Mục tiêu: triển khai nhanh, ít dependency, dễ bảo trì.

### Phương án B – Hybrid Context & Memory

Kết hợp:

- Structured context storage.
- Persistent memory.
- Context retrieval.
- Context summarization.
- Versioning.
- Shared knowledge.
- Context isolation.
- Artifact references.

Cân nhắc SQLite/PostgreSQL, full-text search và semantic retrieval.

### Phương án C – Context Graph & Multi-Team Knowledge

Nghiên cứu kiến trúc nâng cao:

- Context graph.
- Dependency-aware retrieval.
- Cross-team knowledge sharing.
- Memory provenance.
- Decision history.
- Semantic + relational retrieval.
- Dynamic context assembly.

Đánh giá khả năng triển khai theo từng giai đoạn, tránh thiết kế quá mức nhu cầu.

## 8. So sánh và lựa chọn

So sánh ba phương án theo các tiêu chí:

| Tiêu chí                           | A | B | C |
| ------------------------------------ | - | - | - |
| Tương thích codebase              |   |   |   |
| Thời gian triển khai tương đối |   |   |   |
| Độ phức tạp                      |   |   |   |
| Khả năng mở rộng                 |   |   |   |
| Multi-agent support                  |   |   |   |
| Multi-team support                   |   |   |   |
| Persistent memory                    |   |   |   |
| Context isolation                    |   |   |   |
| Token optimization                   |   |   |   |
| Data consistency                     |   |   |   |
| Khả năng chạy local               |   |   |   |
| Chi phí vận hành                  |   |   |   |
| Khả năng bảo trì                 |   |   |   |
| Migration risk                       |   |   |   |

Đưa ra phương án được khuyến nghị cùng lý do kỹ thuật và bằng chứng từ codebase.

Không nhất thiết lựa chọn phương án mạnh nhất.

Có thể đề xuất lộ trình kết hợp A → B → C nếu chứng minh được lợi ích.

---

# PHẦN IV. THIẾT KẾ CHI TIẾT PHƯƠNG ÁN KHUYẾN NGHỊ

## 9. Context Architecture

Thiết kế kiến trúc tổng thể, làm rõ các thành phần cần thiết, ví dụ:

- Context Provider.
- Context Store.
- Context Builder/Assembler.
- Context Retriever.
- Context Budget Manager.
- Context Compressor.
- Context Validator.
- Context Handoff.
- Memory Manager.
- Context Lifecycle Manager.

Đây là danh sách ứng viên, không phải yêu cầu bắt buộc phải xây dựng toàn bộ.

Với mỗi thành phần được lựa chọn, mô tả:

- Trách nhiệm.
- Input/output.
- Interface.
- Storage.
- Dependency.
- Lifecycle.
- Error handling.
- Integration point với codebase hiện tại.

Thiết kế phải tránh tạo thêm abstraction không cần thiết.

## 10. Context Lifecycle

Đề xuất phân tầng context dựa trên phạm vi và vòng đời.

Ví dụ:

- Global context.
- Project context.
- Team context.
- Agent context.
- Session context.
- Task context.
- Execution context.

Đối với mỗi tầng, xác định:

- Ai tạo?
- Ai sở hữu?
- Ai có quyền đọc?
- Ai có quyền cập nhật?
- Khi nào được tạo?
- Khi nào cần refresh?
- Khi nào được nén?
- Khi nào bị vô hiệu hóa/xóa?
- Có persist hay không?
- Có được chia sẻ cho team khác hay không?

Thiết kế quy tắc ưu tiên khi các tầng chứa thông tin xung đột.

## 11. Context Assembly

Thiết kế quy trình xây dựng context trước khi gọi model:

1. Nhận task.
2. Xác định agent và vai trò.
3. Thu thập yêu cầu.
4. Truy xuất context liên quan.
5. Kiểm tra tính hợp lệ và độ mới.
6. Loại trùng lặp.
7. Xếp hạng mức liên quan.
8. Áp dụng token budget.
9. Tạo context package.
10. Gọi model.
11. Thu thập kết quả.
12. Cập nhật state/memory nếu hợp lệ.

Phân tích chi tiết:

- Cách phân bổ token budget.
- Khi nào cần summarization.
- Khi nào phải giữ nguyên dữ liệu gốc.
- Cách hạn chế mất thông tin quan trọng.
- Cách phát hiện context thiếu hoặc lỗi thời.
- Cách xử lý prompt injection từ tài liệu, tool result và memory.
- Cách bảo vệ bí mật, credentials và dữ liệu riêng của từng workspace.

Đề xuất context package schema ở mức thiết kế.

## 12. Agent Handoff

Thiết kế giao thức chuyển giao giữa:

- Agent → Subagent.
- Agent → Agent.
- Team → Team.
- Worker → Worker.
- Session → Session.
- Model/provider → Model/provider.

Một handoff package nên được đánh giá về các thông tin:

- Task ID.
- Objective.
- Scope.
- Constraints.
- Inputs.
- Relevant artifacts.
- Completed work.
- Decisions.
- Open issues.
- Validation status.
- Next actions.
- Source references.
- Version.

Phân biệt giữa handoff của một task và việc chuyển quyền tiếp tục một session.

Thiết kế cơ chế bảo đảm agent nhận không cần đọc lại toàn bộ lịch sử nhưng vẫn đủ dữ liệu để tiếp tục công việc.

## 13. Persistent Memory

Đề xuất hệ thống memory có phân loại rõ:

- Working memory.
- Episodic memory.
- Semantic memory.
- Procedural memory.
- Decision memory.

Đối với từng loại, xác định:

- Dữ liệu được lưu.
- Trigger ghi memory.
- Điều kiện xác thực.
- Thời hạn sử dụng.
- Cơ chế cập nhật.
- Cơ chế quên hoặc vô hiệu hóa.
- Chính sách truy xuất.
- Khả năng chia sẻ.
- Nguồn gốc thông tin.

Không cho phép mọi nội dung do LLM tạo ra tự động trở thành verified memory.

## 14. Context Drift Prevention

Thiết kế cơ chế giảm context drift, gồm:

- Task objective anchoring.
- Requirement traceability.
- Decision validation.
- Handoff validation.
- Context refresh.
- Evidence-based memory.
- Checkpoint/review.
- Drift detection.

Nêu rõ đâu là kiểm tra deterministic, đâu là kiểm tra dựa trên LLM và đâu cần human approval.

Không giả định có thể loại bỏ hoàn toàn drift.

## 15. Storage & Data Model

Đề xuất dữ liệu cần lưu và quan hệ giữa chúng.

Cân nhắc các entity:

- Project.
- Team.
- Agent.
- Session.
- Task.
- ContextEntry.
- ContextPackage.
- MemoryEntry.
- Handoff.
- Artifact.
- Decision.
- SourceReference.
- ExecutionCheckpoint.

Đưa ra:

- ERD hoặc sơ đồ tương đương.
- Khóa và quan hệ chính.
- Quy tắc versioning.
- Concurrency control.
- Data isolation.
- Retention.
- Migration strategy.

Không nhất thiết mỗi entity phải là một database table.

---

# PHẦN V. TÍCH HỢP VỚI HỆ THỐNG HIỆN TẠI

## 16. Integration Strategy

Đối chiếu kiến trúc đề xuất với `window-worker`.

Chỉ ra cụ thể:

- Module có thể tái sử dụng.
- Module cần mở rộng.
- Module cần refactor.
- Module mới cần xây dựng.
- Interface cần bổ sung.
- Vị trí tích hợp vào execution flow.
- Ảnh hưởng đến API hiện tại.
- Ảnh hưởng đến frontend.
- Ảnh hưởng đến storage.
- Ảnh hưởng đến compatibility.

Mọi thay đổi phải truy vết được đến module/file hiện có.

Ưu tiên phương pháp incremental integration thay vì viết lại toàn bộ.

## 17. Tương thích với nhiều loại Agent

Hệ thống cần được đánh giá trong các tình huống:

1. Một coding agent làm việc độc lập.
2. Một lead agent điều phối nhiều subagent.
3. Nhiều agent độc lập cùng làm một project.
4. Nhiều team thực hiện các phase khác nhau.
5. Hai team hoạt động đồng thời.
6. Worker ở máy khác tiếp nhận task.
7. Agent thay đổi model/provider.
8. Session bị gián đoạn và được phục hồi.
9. Agent cần đọc lại quyết định từ nhiều ngày trước.
10. Một yêu cầu kiến trúc thay đổi làm context cũ không còn hợp lệ.

Với mỗi tình huống, mô tả flow, context được sử dụng và cách bảo đảm dữ liệu nhất quán.

## 18. Đánh giá mô hình Agent và Subagent

Phân tích ba mô hình:

- Hierarchical: Lead → Subagents.
- Peer-to-peer: Independent agents.
- Hybrid: Team lead + independent workers.

Đánh giá khả năng tích hợp Context Engineering vào mỗi mô hình.

Làm rõ:

- Memory thuộc agent hay team?
- Context được cấp bởi lead hay Context Service?
- Handoff giữa subagents và giữa independent agents khác nhau thế nào?
- Khi nào context nên được chia sẻ?
- Khi nào cần isolation?
- Tránh lặp retrieval và trùng lặp memory bằng cách nào?

Đưa ra lựa chọn phù hợp dựa trên hiện trạng `window-worker`.

---

# PHẦN VI. KẾ HOẠCH TRIỂN KHAI

## 19. Roadmap

Xây dựng roadmap triển khai theo phase.

Mỗi phase cần có:

- Mục tiêu.
- Phạm vi.
- Module ảnh hưởng.
- Công việc cụ thể.
- Dependency.
- Deliverable.
- Acceptance criteria.
- Rủi ro.
- Điều kiện chuyển sang phase tiếp theo.

Ưu tiên triển khai MVP có thể kiểm chứng trước khi bổ sung graph retrieval hoặc những thành phần phức tạp.

## 20. Evaluation & Benchmark

Đề xuất phương pháp kiểm chứng hiệu quả dựa trên các workflow thực tế.

So sánh hệ thống hiện tại với phương án mới theo:

- Token consumption.
- Context relevance.
- Task completion rate.
- Handoff completeness.
- Recall accuracy.
- Context drift frequency.
- Retrieval latency.
- Execution overhead.
- Recovery success rate.
- Cost per completed task.

Xây dựng ít nhất năm kịch bản benchmark gồm:

1. Coding agent làm task dài qua nhiều session.
2. BA → Architect → Dev → Test.
3. Nhiều agent sửa các module liên quan.
4. Worker bị gián đoạn rồi tiếp tục.
5. Requirement thay đổi làm memory cũ hết hiệu lực.

Đề xuất baseline, cách đo và tiêu chí nghiệm thu.

Nếu chưa có dữ liệu thực nghiệm, không đưa ra phần trăm cải thiện như sự thật.

## 21. Rủi ro và phương án dự phòng

Phân tích:

- Context poisoning.
- Memory contamination.
- Context drift.
- Stale retrieval.
- Memory conflict.
- Concurrent updates.
- Hallucinated handoff.
- Token cost tăng.
- Storage growth.
- Framework lock-in.
- Worker failure.
- Provider incompatibility.
- Security và isolation.

Mỗi rủi ro cần có biện pháp hạn chế, khả năng phát hiện và phương án xử lý.

---

# PHẦN VII. KẾT QUẢ CẦN BÀN GIAO

Hãy tạo một báo cáo kiến trúc chi tiết bằng Markdown trong phản hồi Plan Mode.

Nếu môi trường Plan Mode cho phép tạo plan artifact, sử dụng cơ chế plan sẵn có. Không tạo hoặc sửa file trong repository.

Báo cáo phải có các nội dung:

1. Executive Summary.
2. Research Findings từ DevCon và các nguồn khác.
3. Current Architecture Assessment.
4. Gap Analysis.
5. So sánh ba phương án.
6. Recommended Architecture.
7. Context Lifecycle Design.
8. Memory Architecture.
9. Context Assembly & Handoff.
10. Integration Mapping.
11. Data Model.
12. Multi-Agent/Multi-Team Workflows.
13. Implementation Roadmap.
14. Evaluation Strategy.
15. Risks & Trade-offs.
16. Những quyết định cần được xác nhận trước khi code.

Yêu cầu sơ đồ:

- Current Architecture.
- Proposed Architecture.
- Context Lifecycle.
- Context Assembly Sequence.
- Agent Handoff Sequence.
- Memory Storage Model.
- Multi-Team Context Sharing.

Sử dụng Mermaid khi phù hợp.

## 22. Yêu cầu về chất lượng báo cáo

- Phân tích chuyên sâu nhưng tránh phức tạp hóa không cần thiết.
- Phân biệt rõ nghiên cứu, quan sát codebase và đề xuất.
- Dẫn nguồn cho các nhận định từ bên ngoài.
- Dẫn đường dẫn file/module cho các kết luận từ source code.
- Không tạo ra chi tiết không có bằng chứng.
- Không mặc định framework được đề cập là bắt buộc.
- Không đề xuất xây dựng lại những tính năng đã có và hoạt động tốt.
- Ưu tiên thiết kế có thể triển khai và kiểm thử từng phần.
- Đưa ra các trade-off thay vì chỉ mô tả ưu điểm.
- Không kết thúc ở mức khái niệm: phải xác định được module, interface, data flow và từng bước triển khai.

## 23. Kết luận bắt buộc

Kết thúc báo cáo bằng cách trả lời trực tiếp:

1. Window-worker hiện đang quản lý context như thế nào?
2. Hạn chế quan trọng nhất là gì?
3. Context Engineering có thực sự cần thiết ở giai đoạn này không?
4. Nên xây Context Manager riêng hay mở rộng kiến trúc hiện tại?
5. Có cần Context Graph ngay từ đầu không?
6. Có nên dùng framework ngoài hay tự triển khai?
7. Memory cần được chia sẻ giữa các agent ở mức nào?
8. Thiết kế nào phù hợp nhất cho cả subagent và independent agent?
9. MVP nhỏ nhất nhưng tạo ra giá trị thực tế là gì?
10. Nếu chỉ được ưu tiên ba thay đổi đầu tiên thì nên chọn những gì?

**Chỉ nghiên cứu, phân tích và lập kế hoạch. Không thực hiện bất kỳ thay đổi code nào cho đến khi phương án được xem xét và phê duyệt.**
