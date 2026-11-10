# Đề bài: Context Engineering cho Factory V2 (bản sửa 10/11/2026)

> Bản gốc nhắm vào `window-worker` (V1) được giữ tại [context.v1-window-worker.md](context.v1-window-worker.md).
> Lý do sửa: V1 đã đóng băng (V1 Protection Guard, thôi dùng ở M8/AP-10); phần lớn nội dung đề bài cũ đã được
> thiết kế ở [02-collaboration-and-knowledge.md](architecture/02-collaboration-and-knowledge.md) và đã có code ở M3/M5.

## 1. Mục tiêu

Tìm và thiết kế **những gì còn thiếu** để Factory V2 quản lý context tốt cho nhiều agent và nhiều team chạy song song:
chuyển giao công việc không mất ý, tri thức dài hạn đáng tin, hạn chế drift và tốn token.
**Không** thiết kế lại những gì đã có và đang chạy.

## 2. Đối tượng và hiện trạng phải xuất phát từ đó

- Đối tượng: `apps/factory-host` (Host), `packages/factory-contracts`, các Pack trong `packs/`. Không đụng `apps/windows-worker`, `apps/api`, `apps/dashboard`.
- Tiến độ: M0–M3 và M5 xong; M4 (node phân tán trên hai VM) sắp bắt đầu, hai VM đã sẵn sàng; M6–M8, M2b hoãn; E1b (chạy model thật) chưa chốt.
- Đã có và phải dùng làm đường cơ sở: Context Pack theo attempt, handoff dựng từ sự kiện, knowledge store (FTS5, phân quyền, stale),
  Dossier/Briefing, pack snapshot + skill theo yêu cầu, ngân sách token nhiều cấp, workflow engine, approvals.

## 3. Ba bước, mỗi bước người dùng duyệt rồi mới làm tiếp

1. **Nghiên cứu có nguồn kiểm chứng được.** AI Native DevCon NYC 2026 (Tessl) nếu có bản ghi; nếu không, nói rõ và dùng bài viết đã công bố của
   chính diễn giả hoặc tổ chức của họ, cùng tài liệu chính thức (Anthropic, OpenAI Codex, LangGraph, Letta). Không gán nội dung cho diễn giả khi không có nguồn.
2. **Gap analysis** đối chiếu nghiên cứu với tài liệu 02 và code thật, phân loại Implemented / Partial / Planned / Proposed, có đường dẫn file.
3. **Thiết kế chỉ cho phần thiếu**: thành phần, interface, dữ liệu, điểm tích hợp, roadmap, cách kiểm chứng, rủi ro, quyết định cần duyệt.

## 4. Nguyên tắc

- Chỉ nghiên cứu và viết tài liệu; không sửa code, không migration, không cài package, không chạy model thật.
- Ưu tiên hạ tầng hiện có (SQLite, bảng và tool MCP sẵn có); thành phần mới phải chỉ ra vì sao cái cũ không đủ.
- Không có số đo thì không đưa phần trăm cải thiện. Benchmark cần model thật thì ghi phụ thuộc E1b.
- Tách kiểm tra deterministic, kiểm tra bằng LLM và việc cần người duyệt.
- Mỗi giai đoạn kiến trúc kèm khảo sát OSS áp dụng được ([oss-options.md](architecture/oss-options.md)).

## 5. Câu hỏi bắt buộc trả lời ở cuối

1. Factory V2 đang quản lý context như thế nào?
2. Hạn chế quan trọng nhất là gì?
3. Context Engineering có cần thiết ở giai đoạn này không?
4. Nên xây Context Manager riêng hay mở rộng kiến trúc hiện tại?
5. Có cần Context Graph ngay từ đầu không?
6. Nên dùng framework ngoài hay tự triển khai?
7. Memory cần được chia sẻ giữa các agent ở mức nào?
8. Thiết kế nào phù hợp cho cả subagent và independent agent?
9. MVP nhỏ nhất nhưng có giá trị thật là gì?
10. Nếu chỉ chọn ba thay đổi đầu tiên thì là gì?

## 6. Bàn giao

Một tài liệu: [docs/architecture/12-context-engineering.md](architecture/12-context-engineering.md), cùng mục OSS trong `oss-options.md`.
Sơ đồ Mermaid khi giúp hiểu nhanh hơn chữ. Không code cho đến khi người dùng duyệt các quyết định ở cuối tài liệu.
