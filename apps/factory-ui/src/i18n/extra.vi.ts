import type { extra as en } from './extra.en';
type Translated<T> = { [K in keyof T]: T[K] extends string ? string : Translated<T[K]> };
export const extra: Translated<typeof en> = {
  auth: { signIn: 'Đăng nhập', signOut: 'Đăng xuất', token: 'Mã khởi tạo', required: 'Đăng nhập để tiếp tục.', explanation: 'Mã khởi tạo dùng một lần được Host in ra khi khởi động.' },
  projects: { create: 'Tạo dự án', name: 'Tên dự án', root: 'Đường dẫn làm việc', empty: 'Chưa có dự án.', rootPlaceholder: '/srv/factory/workspaces/my-project' },
  tasks: { plan: 'Kế hoạch', proposed: 'Công việc đề xuất', accept: 'Chấp nhận công việc', decline: 'Từ chối công việc', empty: 'Chưa có công việc.' },
  errors: { title: 'Không tải được dữ liệu', retry: 'Thử lại', correlationId: 'Mã tham chiếu', network: 'Không thể kết nối Host.' },
  empty: { conversations: 'Chưa có hội thoại.', messages: 'Chưa có tin nhắn.', team: 'Chưa có đội ngũ.' },
  shell: { product: 'Factory', theme: 'Giao diện', light: 'Sáng', dark: 'Tối', system: 'Hệ thống', language: 'Ngôn ngữ', english: 'English', vietnamese: 'Tiếng Việt', toggleProjects: 'Ẩn hoặc hiện dự án', live: 'Trực tiếp', reconnecting: 'Đang kết nối lại', offline: 'Ngoại tuyến', welcome: 'Dự án của bạn', chooseProject: 'Chọn hoặc tạo dự án để bắt đầu.', comingSoon: 'Sẽ có ở bước tiếp theo', projectTabs: 'Các chế độ xem dự án' },
  tabs: { chat: 'Trò chuyện', tasks: 'Công việc', team: 'Đội ngũ' },
  validation: { projectName: 'Nhập tên dự án từ 1 đến 160 ký tự.', workspacePath: 'Nhập đường dẫn Linux tuyệt đối tối đa 4096 ký tự, không chứa thành phần . hoặc .., dấu gạch chéo ngược hay ký tự NUL.' },
  team: { engagement: 'Phân công', priority: 'Độ ưu tiên', maxConcurrent: 'Số lượt đồng thời tối đa', state: 'Trạng thái', seats: 'Vị trí', emptySeats: 'Chưa có vị trí được phân công.', lead: 'Trưởng nhóm', role: 'Vai trò', runtime: 'Môi trường chạy', slots: 'Số suất', states: { active: 'Đang hoạt động', paused: 'Tạm dừng', ended: 'Đã kết thúc' } },
  safeErrors: { validation: 'Yêu cầu không hợp lệ.', conflict: 'Tài nguyên đã thay đổi.', 'needs-auth': 'Cần xác thực.', 'permission-configuration': 'Cần cấu hình quyền.', 'resource-exhausted': 'Tài nguyên tạm thời không khả dụng.', 'runtime-unavailable': 'Môi trường chạy không khả dụng.', 'outcome-unknown': 'Chưa xác định được kết quả lệnh.', 'not-found': 'Không tìm thấy tài nguyên.', forbidden: 'Yêu cầu bị từ chối.', unsupported: 'Lệnh không được hỗ trợ.', internal: 'Lỗi nội bộ máy chủ.', network: 'Không thể kết nối Host.', 'bad-response': 'Phản hồi của Host không hợp lệ.', unexpected: 'Không thể hoàn tất thao tác.' },
};
