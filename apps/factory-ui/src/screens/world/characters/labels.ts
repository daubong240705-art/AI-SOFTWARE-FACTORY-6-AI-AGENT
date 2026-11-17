import type { Pose } from './spec';
export const poseLabels: Record<Pose, { vi: string; en: string }> = {
  idle: { vi: 'Đứng yên', en: 'Idle' }, thinking: { vi: 'Suy nghĩ', en: 'Thinking' }, working: { vi: 'Làm việc', en: 'Working' },
  attention: { vi: 'Chú ý', en: 'Attention' }, success: { vi: 'Thành công', en: 'Success' }, error: { vi: 'Lỗi', en: 'Error' }, resting: { vi: 'Nghỉ', en: 'Resting' },
};
