import type { extra as en } from './extra.en';
type Translated<T> = { [K in keyof T]: T[K] extends string ? string : Translated<T[K]> };
export const extra: Translated<typeof en> = {
  auth: { signIn: 'Đăng nhập', signOut: 'Đăng xuất', token: 'Mã khởi tạo', required: 'Đăng nhập để tiếp tục.' },
  projects: { create: 'Tạo dự án', name: 'Tên dự án', root: 'Đường dẫn làm việc', empty: 'Chưa có dự án.' },
  tasks: { plan: 'Kế hoạch', proposed: 'Công việc đề xuất', accept: 'Chấp nhận công việc', decline: 'Từ chối công việc', empty: 'Chưa có công việc.' },
  errors: { title: 'Không tải được dữ liệu', retry: 'Thử lại', correlationId: 'Mã tham chiếu', network: 'Không thể kết nối Host.' },
  empty: { conversations: 'Chưa có hội thoại.', messages: 'Chưa có tin nhắn.', team: 'Chưa có đội ngũ.' },
};
