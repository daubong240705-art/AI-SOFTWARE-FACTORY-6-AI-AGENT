# V1.3 — Đề xuất giao diện và ảnh tham khảo 3D

Trạng thái: thiết kế đề xuất, chưa phải screenshot ASF đã triển khai. Phạm vi: [kế hoạch tổng](README.md).

## 1. Ảnh 3D đã tìm và xem trực tiếp

![Ảnh tham khảo CrewHub World: văn phòng isometric có khu Lead, bàn agent và các kệ workflow](../../docs/windows-worker/v1.3/office-3d-reference.webp)

- Tác giả/nguồn: **CrewHub World — Ekinsol**, [trang giới thiệu chính thức](https://crewhub.dev/world/).
- Ảnh gốc: [Inside a project building](https://crewhub.dev/images/world/building.webp).
- Bản lưu để xem cùng kế hoạch: [office-3d-reference.webp](../../docs/windows-worker/v1.3/office-3d-reference.webp), 1920 × 1200, tải 04/11/2026, giữ nguyên ảnh/nhãn gốc.
- SHA-256: `3b17d6ddd72f0e8f96051c35df63a2674c8884e1841c89a71228de33b527b984`.
- Đây là **ảnh tham khảo bên ngoài**, không phải ảnh tạo riêng, UI đã code hoặc bằng chứng runtime thật của ASF. Bản demo trong ảnh có ghi replies are scripted.
- Ảnh chỉ phục vụ trao đổi thiết kế; không nhúng vào sản phẩm, không coi screenshot được cấp phép như asset CC0. Chưa xác minh giấy phép phân phối riêng của screenshot; giữ nguồn và không đưa vào gói app/release. Không sao chép code/model/texture của CrewHub.

Đã chọn phương án **tìm ảnh** theo yêu cầu “tạo hoặc kiếm”. Không gọi image generation, Canva hoặc CLI/API tạo ảnh. Công cụ image_gen trực tiếp không khả dụng trong phiên lập kế hoạch; CLI fallback cần `OPENAI_API_KEY` và chỉ dùng khi người dùng chọn phương án đó, nên không sử dụng ở đây.

## 2. Áp dụng vào ASF

Giữ ý tưởng **phòng mở, góc nhìn isometric, Lead có vị trí riêng, task và trạng thái nhìn được tại bàn agent**. Thiết kế ASF chỉ dùng một phòng nhỏ với bảy vị trí. Không cần thị trấn, đường phố, cửa hàng, khu giải trí hoặc nhân vật đi bộ dài để hiểu công việc.

| Thành phần | Đề xuất ASF |
|---|---|
| Phòng | Một sàn đơn giản, hai vách thấp, nền trung tính; vừa khung nhìn ngay khi mở |
| Lead | Bàn ở đầu phòng, có nhãn Lead, sáng khi đang lập kế hoạch/review/trả lời |
| Sáu role | Hai cụm ba bàn PM/BA/BE và FE/TEST/DEVOPS; nhãn HTML overlay dễ đọc |
| Trạng thái | Chấm màu + chữ; agent rảnh ngồi yên, đang chạy có đèn/nhịp animation nhẹ |
| Công việc | Hover một dòng; click mở inspector thật; không gắn đoạn mô tả dài trên mọi bàn |
| Workflow | Một bảng tổng hợp nhỏ trong phòng; click mở Kanban 2D đầy đủ |
| Trang trí | Tối thiểu: cây/chậu, đèn, bảng; không che nhãn hoặc gây khó click |
| Camera | Orthographic isometric, pan/zoom giới hạn và nút về góc mặc định |

Nếu role có hai execution, bàn hiện `2 tác vụ` và inspector liệt kê từng execution. Bảy bàn thể hiện bảy role, không hứa hệ thống đang chạy đồng thời bảy agent.

## 3. Bố cục ứng dụng

Giữ Chat là nơi giao việc. Thêm hai đích **Công việc** và **Văn phòng** trong navigation hiện có; không mở thêm app hay cửa sổ bắt buộc.

```text
┌──────────────┬──────────────────────────────────────────────────────────┐
│ ASF          │ Project ▾   Chat | Công việc | Văn phòng       Chạy ở X │
│ Projects     ├──────────────────────────────────────────────────────────┤
│ Conversations│ Đang làm 2   Rảnh 4   Cần xử lý 1   3/8 task xác minh   │
│              ├───────────────────────────────────────┬──────────────────┤
│              │                                       │ Chi tiết         │
│              │  Kanban HOẶC phòng 3D                 │ FE · Đang sửa    │
│              │                                       │ Task / Model     │
│              │  Click card/bàn chọn cùng một task    │ Thay đổi         │
│              │                                       │ Hoạt động        │
│              ├───────────────────────────────────────┴──────────────────┤
│ Settings     │ Cần bạn xử lý 1                           Mở Chat        │
└──────────────┴──────────────────────────────────────────────────────────┘
```

Số trong wireframe là ví dụ bố cục, không phải số liệu runtime. Bộ đếm thực tế phải rõ phạm vi project/role/execution và không đếm trùng.

**Màn Công việc:** thanh agent gọn ở đầu, filter một hàng, Kanban bên dưới. Roster có thể thu gọn. Inspector chỉ mở khi chọn. Không ép bảng agent, board, scene và raw log cùng hiện trong một màn.

**Màn Văn phòng:** toolbar gọn `Đội ngũ · Chất lượng · Về góc mặc định · 2D`; scene chiếm phần chính, inspector bên phải khi cần. Bộ đếm tiến độ nằm ngoài canvas nên vẫn đọc được khi WebGL lỗi.

**Màn Chat:** giữ soạn thảo và lịch sử hiện tại; một chip gọn “BE đang sửa … · 2 tác vụ chạy · Xem công việc”. Những việc cần người dùng xử lý hiện thành hành động đúng ngữ cảnh. Không tự chuyển tab khi agent đổi trạng thái.

## 4. Card và inspector

Card runtime tối đa bốn hàng: **tiêu đề**, `role · trạng thái`, `task ID · thời lượng`, `thay đổi / acceptance / cần xử lý` khi có dữ liệu. Model nằm trong inspector/tooltip để giảm chữ lặp. Card backlog có ưu tiên/role gợi ý và menu chỉnh sửa.

Sắp ưu tiên backlog chỉ là kế hoạch. Không kéo card để đổi model/scope hoặc preempt task đang chạy. Controller tiếp tục quyết định thực thi theo queue/policy/dependency hiện có.

Inspector desktop khoảng 340–400 px, có thể đóng; màn nhỏ dùng drawer. Header: role/task và badge trạng thái. Ba tab **Công việc / Thay đổi / Hoạt động**. Nút chính phụ thuộc state; không đặt nhiều nút luôn luôn hoạt động.

Ở 1366 × 768: Kanban cuộn ngang có tiêu đề cột cố định; inspector dạng drawer khi không đủ rộng. Ở 1920 × 1080: đủ không gian cho board/scene và inspector. Không thu font xuống để ép sáu cột vừa mọi cửa sổ.

## 5. Chữ, màu và độ gọn

- Tái sử dụng tokens/theme của Windows Worker và tinh thần bộ giao diện 9Router trong `ui/`: nền xám tối, tương phản rõ, accent cam ấm.
- Font hệ thống có tiếng Việt: `Segoe UI`, system-ui; body 14 px, tiêu đề 16–20 px, metadata tối thiểu 12 px. Không thêm dịch vụ font mạng.
- Màu gợi ý: Rảnh xám trung tính; Đang làm xanh lam; Review tím; Cần xử lý hổ phách; Lỗi đỏ; Xong xanh lá. Luôn kèm chữ/icon, không chỉ dựa vào màu.
- Nhãn ngắn: “Rảnh”, “Đang đọc”, “Đang sửa”, “Chờ model”, “Chờ bạn”, “Chờ lượt”, “Review”, “Lỗi”, “Gián đoạn”. Không thêm văn quảng cáo hoặc mô tả tính năng lặp lại.
- Timeline không auto-scroll cưỡng bức khi người dùng đang đọc mục cũ. Có nút “Có cập nhật mới”.
- Animation chỉ ở trạng thái đang hoạt động; ưu tiên đèn màn hình/tay gõ nhẹ. Reduced motion giữ chấm trạng thái tĩnh.

## 6. Fallback và hiệu năng thiết kế

- Chưa tải được 3D: hiển thị bảng agent 2D ngay, không để mất thông tin hoặc che nút Stop.
- Không WebGL/context loss: báo một dòng “3D chưa khả dụng — dùng chế độ 2D”, giữ board/inspector đầy đủ.
- Scene lazy load, geometry/material dùng chung, shadow đơn giản hoặc tắt ở chất lượng thấp; không physics/post-processing nặng trong V1.3.
- Render on-demand khi không có animation; giới hạn 30 FPS khi cần; tab scene ẩn/minimize ngừng frame loop.
- Tắt hiệu ứng không tắt cập nhật dữ liệu hay runtime. Không có nút “Pause agent” khi chức năng thật chỉ là pause render.
- Mọi thao tác thiết yếu đều có ở 2D bằng bàn phím; avatar không là cách duy nhất để chọn task.

## 7. Nguồn asset có thể xem xét lúc triển khai

[Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) là một nguồn đồ nội thất low-poly; trang chính thức ghi **Creative Commons CC0**. Đây là ứng viên, chưa tải/import model hoặc thực thi script nào. Khi dùng thực tế phải lưu đúng tên gói, version, file license và hash của archive; license screenshot của dự án tham khảo không được suy ra từ license của bộ asset này.

Ưu tiên tự dựng bàn/ghế/avatar đơn giản bằng geometry để dễ tùy màu và giữ scene nhẹ. Nếu asset ngoài không làm rõ UI tốt hơn thì không thêm chỉ để đẹp hơn.

## 8. Kết quả thiết kế cần có ở cuối D

Ảnh thực tế ASF ở ba trạng thái: idle/configured; hai task đang chạy; một việc cần xử lý kèm inspector. Cần thêm ảnh Kanban và fallback 2D. Tất cả lấy từ bản đã code, có thể dùng fixtures để chụp bố cục nhưng phải ghi rõ fixture; nghiệm thu runtime riêng dùng dữ liệu thật theo [implementation](implementation.md).
