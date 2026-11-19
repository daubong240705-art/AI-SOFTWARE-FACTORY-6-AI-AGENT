export const screens = [
  { id: 'overview', area: 'toan-he-thong', hash: '#/overview' },
  { id: 'attention', area: 'toan-he-thong', hash: '#/attention' },
  { id: 'team', area: 'toan-he-thong', hash: '#/team' },
  { id: 'team-config', area: 'toan-he-thong', hash: '#/team/config' },
  { id: 'library', area: 'toan-he-thong', hash: '#/library' },
  { id: 'world', area: 'toan-he-thong', hash: '#/world' },
  { id: 'system', area: 'toan-he-thong', hash: '#/system' },
  { id: 'mascots', area: 'toan-he-thong', hash: '#/mascots' },
  { id: 'portal', area: 'toan-he-thong', hash: '#/portal' },
  { id: 'sign-in', area: 'toan-he-thong', signIn: true },
  { id: 'library-templates', area: 'toan-he-thong', hash: '#/library', open: page => tab(page, 'Mẫu agent').click(), ready: 'Tạo mẫu' },
  { id: 'project-overview', area: 'trong-project', project: true, tab: 'overview' },
  { id: 'project-agents', area: 'trong-project', project: true, tab: 'agents' },
  { id: 'project-office', area: 'trong-project', project: true, tab: 'office' },
  { id: 'project-board', area: 'trong-project', project: true, tab: 'board' },
  { id: 'project-knowledge', area: 'trong-project', project: true, tab: 'knowledge' },
  { id: 'project-code', area: 'trong-project', project: true, tab: 'code' },
  { id: 'project-flows', area: 'trong-project', project: true, tab: 'flows' },
  { id: 'project-flow-detail', area: 'trong-project', project: true, tab: 'flows', flow: true },
  { id: 'project-run-waiting', area: 'trong-project', project: true, tab: 'flows', run: 'waiting' },
  { id: 'project-run-finished', area: 'trong-project', project: true, tab: 'flows', run: 'finished' },
  { id: 'project-empty-flows', area: 'trong-project', project: 'empty', tab: 'flows' },
  { id: 'project-workflow-v1', area: 'trong-project', project: true, tab: 'workflow' },
  ...['automation', 'budget', 'autonomy', 'approvals', 'workflow', 'code'].map(section => ({
    id: `project-settings-${section}`, area: 'trong-project', project: true, tab: 'settings', section,
  })),
];

export const button = (scope, name) => scope.getByRole('button', { name, exact: typeof name === 'string' });
export const tab = (scope, name) => scope.getByRole('tab', { name, exact: true });
export const dialog = page => page.getByRole('dialog').last();
export const agentMenu = async (page, name, action) => {
  await button(page, `Thao tác với ${name}`).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
export const createMenu = async (page, name) => {
  await button(page.locator('.app > header'), 'Tạo').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};
export async function sidebar(page) {
  const nav = page.locator('#factory-navigation');
  if (await button(page, 'Ẩn hoặc hiện dự án').isVisible() && !await nav.isVisible()) await button(page, 'Ẩn hoặc hiện dự án').click();
  return nav;
}

const openButton = name => page => button(page, name).click();
const modal = (id, screen, action, ready) => ({ id, screen, open: async (page, fixture) => {
  await action(page, fixture);
  await dialog(page).waitFor();
  if (ready) await ready(dialog(page)).waitFor();
} });
const skillAction = action => async page => { await button(page, /audit-skill/).click(); await button(page.getByRole('main'), action).click(); };
const templateAction = action => async page => { await button(page, /Mẫu audit/).click(); await button(page.getByRole('main'), action).click(); };
const teamAction = action => page => button(page.locator('article').filter({ has: page.getByRole('heading', { name: 'Đội audit', exact: true }) }), action).click();
const navAction = async (page, name) => button(await sidebar(page), name).click();
const editAgent = page => agentMenu(page, 'Audit Fresh', 'Sửa');
export const dialogs = [
  modal('new-project', 'overview', page => createMenu(page, 'Dự án mới')),
  modal('new-game', 'overview', page => createMenu(page, 'Game mới')),
  modal('project-folder', 'overview', async page => { await createMenu(page, 'Dự án mới'); await button(dialog(page), /Chọn.*(thư mục|kho)|Duyệt/).click(); }),
  modal('search', 'overview', page => page.getByRole('textbox', { name: 'Tìm việc' }).click()),
  modal('settings', 'overview', page => navAction(page, 'Cài đặt')),
  modal('system-model-picker', 'system', openButton('Đổi model')),
  { id: 'new-task', screen: 'project-board', open: async page => { await createMenu(page, 'Việc mới'); await page.getByLabel('Tiêu chí nghiệm thu').waitFor(); } },
  { id: 'task-detail', screen: 'project-board', open: async (page, fixture) => { await page.locator(`[data-task-id="${fixture.task}"]`).click(); await page.getByRole('heading', { name: 'Việc nháp audit' }).waitFor(); } },
  { id: 'decision', screen: 'attention', open: async (page, fixture) => { await approvalRow(page, fixture.approval).click(); await page.getByRole('radio', { name: /^Duyệt/ }).waitFor(); } },
  { id: 'decision-confirm', screen: 'attention', open: async (page, fixture) => { await approvalRow(page, fixture.approval).click(); await page.getByRole('radio', { name: /^Duyệt/ }).click(); await page.locator('[data-attention-primary]').click(); await button(page, 'Xác nhận').waitFor(); } },
  modal('project-preview', 'project-overview', openButton('Xem thử game')),
  modal('project-archive', 'project-settings-automation', openButton(/Lưu trữ dự án/)),
  modal('agent-create', 'project-agents', openButton('Tạo agent'), scope => scope.getByLabel('Tên', { exact: true })),
  modal('agent-edit', 'project-agents', editAgent, scope => tab(scope, 'Hồ sơ')),
  modal('agent-comparison', 'project-agents', async page => { await editAgent(page); await tab(dialog(page), 'Lịch sử').click(); await dialog(page).getByLabel('Lịch sử', { exact: true }).selectOption('1'); }, scope => scope.getByText('Phiên bản đã chọn', { exact: true }).first()),
  modal('agent-clone', 'project-agents', page => agentMenu(page, 'Audit Fresh', 'Nhân bản')),
  modal('agent-archive', 'project-agents', page => agentMenu(page, 'Audit Fresh', 'Lưu trữ')),
  modal('agent-delete', 'project-agents', page => agentMenu(page, 'Audit Fresh', 'Xóa')),
  modal('agent-from-template', 'project-agents', openButton('Tạo từ mẫu')),
  modal('agent-save-template', 'project-agents', page => agentMenu(page, 'Audit Fresh', 'Lưu làm mẫu')),
  modal('team-create', 'project-agents', openButton('Tạo đội')),
  modal('team-edit', 'project-agents', teamAction('Sửa')),
  modal('team-delete', 'project-agents', teamAction('Xóa')),
  modal('skill-create', 'library', openButton('Tạo skill')),
  modal('skill-edit', 'library', skillAction('Sửa')),
  modal('skill-delete', 'library', skillAction('Xóa')),
  modal('template-create', 'library-templates', openButton('Tạo mẫu')),
  modal('template-edit', 'library-templates', templateAction('Sửa')),
  modal('template-delete', 'library-templates', templateAction('Xóa')),
  modal('flow-create', 'project-flows', openButton('Tạo quy trình')),
  modal('flow-import-v1', 'project-flows', openButton('Nhập từ quy trình cũ')),
  modal('flow-test', 'project-flow-detail', openButton('Chạy thử')),
  modal('flow-run', 'project-flow-detail', openButton('Chạy')),
  modal('flow-cancel-run', 'project-run-waiting', openButton('Hủy lượt chạy')),
  modal('workflow-v1-create', 'project-workflow-v1', openButton(/Tạo quy trình/)),
  modal('document-upload', 'project-knowledge', openButton('Tải lên')),
  modal('autonomy-edit', 'project-settings-autonomy', page => button(page.getByRole('main'), /^Sửa|Đổi|Điều chỉnh/).first().click()),
  modal('standing-approval-create', 'project-settings-approvals', openButton('Thêm quyền cho phép sẵn')),
  modal('automation-schedule-create', 'project-settings-automation', openButton('Thêm lịch')),
  modal('automation-rule-create', 'project-settings-automation', openButton('Thêm quy tắc')),
  modal('automation-monitor-create', 'project-settings-automation', openButton('Thêm giám sát')),
  modal('workflow-v1-add-stage', 'project-workflow-v1', async page => { await button(page, 'Sửa kế hoạch').click(); await button(page, 'Thêm bước').click(); }),
];

export const approvalRow = (page, id) => page.locator(`[data-row-key="approval:${id}"]`);

export const checklist = [
  ['C1', 'Tìm thấy được'], ['C2', 'Form rõ'], ['C3', 'Kiểm lỗi'], ['C4', 'Phản hồi'],
  ['C5', 'Xóa an toàn'], ['C6', 'Xung đột'], ['C7', 'Rỗng/tải/lỗi'], ['C8', 'Nhất quán'],
  ['C9', 'Bàn phím/trợ năng'], ['C10', 'Kích thước'], ['C11', 'Ngôn ngữ'], ['C12', 'Không giả'],
];

export function hashFor(screen, projectId) {
  if (screen.hash) return screen.hash;
  const base = `#/project/${encodeURIComponent(projectId)}`;
  if (screen.flowId) return `${base}/flows/${encodeURIComponent(screen.flowId)}`;
  if (screen.tab === 'overview') return base;
  if (screen.tab === 'settings') return `${base}/settings/${screen.section}`;
  if (screen.tab === 'workflow' || screen.tab === 'code') return `${base}/settings/${screen.tab}`;
  return `${base}/${screen.tab}`;
}

const projectTabs = { agents: 'Agent & Đội', office: 'Văn phòng', board: 'Bảng việc', knowledge: 'Tài liệu', flows: 'Quy trình' };
const settings = { automation: 'Tự động', budget: 'Ngân sách', autonomy: 'Mức tự chủ', approvals: 'Phê duyệt sẵn', workflow: 'Quy trình', code: 'Mã nguồn' };

export async function openScreen(page, screen, fixture, base) {
  if (screen.signIn) {
    await page.goto(base);
    await button(page, 'Đăng nhập').waitFor();
    return;
  }
  if (!screen.project) {
    await page.goto(`${base}/${screen.hash}`);
    await page.locator('#factory-main').waitFor();
    await page.waitForFunction(hash => location.hash === hash, screen.hash);
    if (screen.open) await screen.open(page, fixture);
    if (screen.ready) await button(page, screen.ready).waitFor();
    return;
  }
  await page.goto(`${base}/#/overview`);
  await page.locator('#factory-main').waitFor();
  const key = screen.project === 'empty' ? 'empty' : 'primary';
  const projectId = fixture.projects[key];
  await navAction(page, fixture.projectNames[key]);
  const header = page.locator('.project-view header').first();
  await header.getByRole('heading', { name: fixture.projectNames[key] }).waitFor();
  if (projectTabs[screen.tab]) await tab(header, projectTabs[screen.tab]).click();
  const section = screen.section ?? (['workflow', 'code'].includes(screen.tab) ? screen.tab : null);
  if (section) {
    await button(header, 'Cài đặt').click();
    await button(page.getByRole('main'), settings[section]).click();
  }
  const target = screen.flow ? { ...screen, flowId: fixture.flow } : screen;
  if (screen.flow) await page.getByRole('link', { name: 'Mở quy trình: Quy trình audit', exact: true }).click();
  if (screen.run) {
    await button(page, screen.run === 'waiting' ? /Quy trình audit.*Đang chờ/ : /Quy trình audit.*Thành công/).click();
    await page.waitForFunction(id => location.hash.endsWith(`/runs/${id}`), fixture.runs[screen.run]);
  } else await page.waitForFunction(hash => location.hash === hash, hashFor(target, projectId));
  if (screen.flow || screen.run) await page.getByRole('region', { name: 'Sơ đồ quy trình', exact: true }).waitFor();
  else if (screen.tab === 'flows') await button(page, 'Tạo quy trình').waitFor();
  else if (screen.tab === 'agents') await button(page, 'Tạo agent').waitFor();
  else if (screen.tab === 'board' && key === 'primary') await page.locator(`[data-task-id="${fixture.task}"]`).waitFor();
}
