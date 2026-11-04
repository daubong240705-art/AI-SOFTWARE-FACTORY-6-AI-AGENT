# Windows AI Worker — Kế hoạch triển khai sản phẩm

Ngày lập: 04/11/2026. Trạng thái: **WW-1 và WW-2 đã triển khai**; [chạy desktop](../../apps/windows-worker/README.md), [evidence DeepSeek Flash](../../docs/windows-worker/ww2-completion.md). WW-3 đến WW-5 chưa triển khai.

Nguồn yêu cầu: [Đặc tả MVP](../../AI_Software_Factory_Lite_Windows_Worker_MVP.md). Chỉ dẫn mới nhất của người dùng: bỏ bước chứng minh runtime trên repo mẫu, tập trung hoàn thiện sản phẩm.

## 1. Phạm vi đã chốt

Xây ứng dụng Windows độc lập: chọn thư mục source → nhập yêu cầu → Lead giao việc → agent sửa code → chạy lệnh cần thiết → xem diff và kết quả. Người dùng cấu hình 9Router và chọn model riêng cho Lead, PM, BA, BE, FE, TEST, DEVOPS.

- Standalone là sản phẩm đầu tiên; không phụ thuộc ASF web, GitLab, OpenProject hay các VM.
- Một run hoạt động trong toàn ứng dụng; các task và agent chạy tuần tự.
- Lead luôn bật. Sáu role khác được bật/tắt và không bắt buộc tham gia mọi yêu cầu.
- OpenCode thực thi coding/tool; Controller quản lý vòng đời, dữ liệu, tiến trình và giới hạn.
- Giao diện tiếng Việt, gọn theo bộ ảnh 9Router trong `ui/`; giữ nguyên các ảnh gốc.
- App hỗ trợ repo local tin cậy, chạy bằng tài khoản Windows thông thường. Không tuyên bố native shell được cô lập hoàn toàn.
- Không thay đổi hoặc deploy lại ASF đang chạy. Connected Mode là hạng mục sau MVP.

## 2. Thay đổi so với thứ tự trong đặc tả

Không có Phase 0, repo mẫu, spike model hoặc mốc nghiệm thu runtime riêng. Bắt đầu bằng khung desktop và các màn hình sử dụng thật. Adapter OpenCode được tích hợp trực tiếp ở WW-2; xử lý tương thích CLI/SDK nằm trong đầu việc đó.

Không chạy kiểm chứng model, SSH, build hay test trong công việc lập kế hoạch này. Khi code, các kiểm tra phục vụ thay đổi nằm trong công việc phát triển tương ứng, không trở thành một dự án thử nghiệm hoặc phase chặn riêng.

## 3. Danh sách kế hoạch

| Thứ tự | Tài liệu | Kết quả người dùng nhận được |
|---|---|---|
| Thiết kế chung | [Kiến trúc và hợp đồng dữ liệu](architecture.md) | Ranh giới module, trạng thái, lưu trữ, policy |
| WW-1 | [Desktop, project và cấu hình](phase-1-desktop.md) | Mở app, chọn source, cấu hình gateway và đội agent |
| WW-2 | [Thực thi công việc với OpenCode](phase-2-execution.md) | Gửi task, sửa source thật, xem activity và dừng tác vụ |
| WW-3 | [Lead và sáu role](phase-3-team.md) | Giao việc tự động, model theo role, sửa lỗi có giới hạn |
| WW-4 | [Hoàn thiện trải nghiệm làm việc](phase-4-workspace.md) | Diff, kết quả build/test, lịch sử, phục hồi và local preview |
| WW-5 | [Đóng gói Windows và bàn giao](phase-5-release.md) | Bộ cài, dữ liệu bền vững, hướng dẫn sử dụng ngắn |

Thứ tự: WW-1 → WW-2 → WW-3 → WW-4 → WW-5. Khung history, result và process manager được tạo sớm, hoàn thiện ở phase tương ứng; không viết lại UI giữa các phase.

## 4. Công nghệ triển khai

| Lớp | Lựa chọn |
|---|---|
| Desktop | Electron + React + TypeScript, electron-vite |
| UI | CSS tokens và component nhỏ; tái sử dụng phần phù hợp của ASF, không kéo Next.js server vào desktop |
| Controller | TypeScript trong Electron main; runtime/process chạy ngoài renderer |
| Lưu trữ | SQLite qua better-sqlite3 13; migration có version; binary Node-API dùng chung Node/Electron, không rebuild |
| Runtime | OpenCode bản được pin trong adapter sau khi xác định giao diện thực tế lúc tích hợp |
| Gateway | 9Router; provider/model config sinh theo schema runtime thực tế |
| Secrets | Electron safeStorage trên Windows; ciphertext ngoài repo, không lưu key plaintext trong SQLite |
| Đóng gói | electron-builder, Windows x64, bộ cài NSIS |

Phiên bản dependency cụ thể được pin vào lockfile khi dựng app; kế hoạch không coi API OpenCode nào là đã xác minh.

## 5. Cách triển khai và theo dõi

- Đặt code trong `apps/windows-worker/`, tách khỏi dashboard và worker Linux hiện tại.
- Mỗi đầu việc có mã `WW<phase>-<số>`. WW-1/WW-2 đã triển khai; các đầu việc WW-3 đến WW-5 **chưa làm**.
- Mỗi phase kết thúc bằng commit có phạm vi rõ, cập nhật mục đã hoàn thành và giới hạn thực tế. Không tick chỉ vì đã có màn hình hoặc mock.
- Không bắt buộc tạo OpenProject WP, MR remote hay pipeline release ASF để phát triển desktop local.
- Không build image ASF mỗi lần sửa desktop. Nếu thêm CI, chỉ check desktop khi thay đổi path liên quan; build installer theo yêu cầu phát hành.
- Không thêm framework điều phối, marketplace, nhiều worker hoặc tự deploy production vào MVP.

## 6. Mốc hoàn thành sản phẩm

| Mốc | Phạm vi |
|---|---|
| W1 — Khung dùng được | Project, settings và team lưu được, app mở lại giữ cấu hình |
| W2 — Có thực thi | Task tạo thay đổi source qua runtime, activity và Stop có tác dụng thật |
| W3 — Đội agent | Lead giao role cần thiết, model riêng, có báo cáo và vòng sửa lỗi hữu hạn |
| W4 — Dùng hằng ngày | Giữ thay đổi có sẵn của người dùng, xem diff/history/result, xử lý gián đoạn |
| W5 — Bản cài | Cài trên Windows, có hướng dẫn toolchain, giữ dữ liệu khi cập nhật |

Chưa ước lượng ngày bàn giao: thời gian phụ thuộc giao diện OpenCode trên Windows và độ tương thích tool calling của model do 9Router cung cấp. Báo tiến độ bằng chức năng đã hoàn thành.

## 7. Ngoài MVP

Connected Mode, sửa protocol của ASF, chạy song song/worktree, đa worker, sandbox cho source không tin cậy, ký số và auto-update, marketplace, memory dài hạn, văn phòng 3D. Không dùng các mục này làm điều kiện bắt đầu hoặc kết thúc bản Standalone.
