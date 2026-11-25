// Translate only fixed Host messages, following automationErrors.
const messages: Record<string, string> = {
  'project not found': 'projectMissing',
  'team not found': 'teamMissing',
  'project subject must match project id': 'projectMismatch',
  'project scope must match project id': 'projectMismatch',
  'autonomy revision changed': 'revisionChanged',
  'model settings revision changed': 'revisionChanged',
  'autonomy setting does not exist': 'settingMissing',
  'standing approval revision changed': 'revisionChanged',
  'standing approval not found': 'approvalMissing',
  'standing approval id already exists': 'duplicateId',
  'active standing approval limit reached': 'approvalLimit',
  'standing approval must expire in the future within 30 days': 'expiryInvalid',
  'invalid standing approval': 'approvalInvalid',
  'Unsupported standing action kind': 'actionInvalid',
};
export function settingsErrorKey(message: string) {
  const archive: Record<string, string> = {
    'Dự án còn lượt chạy đang hoạt động hoặc chưa rõ kết quả. Hãy dừng lượt chạy và đối soát trước khi xoá dự án.': 'live',
    'Dự án còn run đang hoạt động hoặc chưa rõ kết quả. Hãy dừng run và đối soát trước khi xoá dự án.': 'live',
    'Dự án đang phát hành. Hãy chờ phát hành hoàn tất trước khi xoá dự án.': 'release',
    'Tên xác nhận phải trùng khớp chính xác với tên dự án.': 'name',
    'Dự án đã thay đổi. Hãy tải lại trước khi xoá.': 'revision',
    'Dự án đã được lưu trữ.': 'archived',
  };
  if (Object.hasOwn(archive, message)) return `projectArchive.errors.${archive[message]}`;
  return Object.hasOwn(messages, message) ? `settingsWrite.hostErrors.${messages[message]}` : undefined;
}
