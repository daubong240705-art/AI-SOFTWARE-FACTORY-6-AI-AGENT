# V1.1 — Worker dùng ổn định hằng ngày

Hoàn thành ngày 04/11/2026, ứng dụng `1.1.0`. [Bàn giao, bằng chứng và giới hạn](../../windows-worker/v1.1-completion.md). 92/92 test và acceptance Windows/Electron/model thật đạt.

Baseline `2d632d8`; checkpoint `checkpoint/v11-20261104`. Roadmap người dùng `AI_Software_Factory_Post_MVP_Roadmap.md` là tài liệu đầu vào, không tự sửa/commit thay người dùng.

Giữ một Controller, một run và task tuần tự. Tái sử dụng schema6, snapshot/evidence, handoff/skills, proxy failure latch và metrics. Không thêm retry task, orchestrator, model fallback hoặc dịch vụ mạng.

Phạm vi: phát hiện source thay đổi đồng thời và giữ phản hồi; checkpoint/recovery có xác minh trước attempt mới; sở hữu cây tiến trình Windows và quản lý local command/preview; đóng app có xử lý rõ; export/retention dữ liệu; kiểm chứng luồng chính/lỗi và tài liệu. Resume là tiếp tục công việc bằng attempt mới sau đối chiếu source, không nhận lại session/tool dang dở. Không coi shell là OS sandbox. Full access giữ chính sách role/scope hiện có.

Không thuộc V1.1: parallel/worktree scheduler, 3D, Factory Connected, installer/auto-update, marketplace hoặc thay VM. Chức năng đóng gói WW-5 vẫn có milestone riêng; không khẳng định MVP đã phát hành.
