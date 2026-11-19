import assert from 'node:assert/strict';
import { agentMenu, approvalRow, button, createMenu, dialog, openScreen, screens, tab } from './screens.mjs';
import { createTask, waitForRun } from './seed.mjs';

const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const field = (scope, name) => scope.getByLabel(name, { exact: true });
const visible = locator => locator.waitFor({ state: 'visible' });
const hidden = locator => locator.waitFor({ state: 'hidden' });
const step = (name, expected, run) => ({ name, expected, run });
const agentName = 'Agent thao tác audit';
const cloneName = 'Bản sao audit';
const teamName = 'Đội thao tác audit';
const editedTeam = 'Đội đã sửa audit';
const skillName = 'skill-thao-tac-audit';
const templateName = 'Mẫu thao tác audit';
const editedTemplate = 'Mẫu đã sửa audit';
const flowTitle = 'Quy trình thao tác audit';

async function saveDialog(page, label = 'Lưu') {
  await button(dialog(page), label).click();
  await hidden(page.getByRole('dialog'));
}

async function connect(page, from, port, to) {
  const source = page.locator(`.react-flow__node[data-id="${from}"] .source[data-handleid="${port}"]`);
  const target = page.locator(`.react-flow__node[data-id="${to}"] .target`);
  await source.scrollIntoViewIfNeeded();
  await source.dragTo(target);
  await page.locator(`.react-flow__edge[aria-label="${from}:${port} → ${to}"]`).waitFor({ state: 'attached' });
}

function scenarios(page, fixture, base) {
  const project = fixture.projects.primary;
  const api = fixture.api;
  const go = key => openScreen(page, screens.find(item => item.id === key), fixture, base);
  const main = () => page.locator('#factory-main');
  const modal = () => dialog(page);
  const agentAction = action => agentMenu(page, agentName, action);
  const agentRow = name => page.locator('li').filter({ has: button(page, `Thao tác với ${name}`) });
  const teamRow = name => page.locator('article').filter({ has: heading(page, name) });
  const relationTable = () => page.getByRole('table', { name: 'Quan hệ', exact: true });
  const entry = name => main().getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
  const getAgents = () => api.json(`/projects/${project}/agents`);
  const relationSection = () => main().locator('section').filter({ has: heading(page, 'Quan hệ') });
  let flowId;
  let runId;
  return [
    { id: 'agent', steps: [
      step('create', 'Tên agent mới xuất hiện trong danh sách.', async () => {
        await go('project-agents'); await button(main(), 'Tạo agent').click();
        await field(modal(), 'Tên').fill(agentName); await field(modal(), 'Vai trò').fill('Kiểm thử');
        await saveDialog(page); await visible(agentRow(agentName));
      }),
      step('edit', 'Vai trò mới xuất hiện trong danh sách.', async () => {
        await agentAction('Sửa'); await field(modal(), 'Mô tả').fill('Mô tả sau khi sửa');
        await field(modal(), 'Vai trò').fill('Kiểm tra bản sửa');
        await button(modal(), 'Lưu').click();
        await visible(page.getByText('Đã lưu thay đổi.', { exact: true }).first());
        await button(modal(), 'Hủy').click();
        await visible(agentRow(agentName).getByText(/^Kiểm tra bản sửa ·/));
      }),
      step('history', 'Bản r1 hiển thị phần so sánh với bản hiện tại.', async () => {
        await agentAction('Sửa'); await tab(modal(), 'Lịch sử').click(); await field(modal(), 'Lịch sử').selectOption('1');
        await visible(modal().getByText('Phiên bản đã chọn', { exact: true }).first());
      }),
      step('rollback', 'Khôi phục r1 tạo bản mới và phục hồi vai trò cũ.', async () => {
        await button(modal(), 'Khôi phục bản này').click();
        await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] option')].some(option => /^r3\b/.test(option.textContent.trim())));
        await button(modal(), 'Hủy').click();
        await visible(agentRow(agentName).getByText(/^Kiểm thử ·/));
      }),
      step('clone', 'Bản sao mang tên mới xuất hiện.', async () => {
        await agentAction('Nhân bản'); await field(modal(), 'Tên').fill(cloneName);
        await saveDialog(page, 'Nhân bản'); await visible(agentRow(cloneName));
      }),
      step('pause', 'Agent xuất hiện trong bộ lọc Tạm dừng.', async () => {
        await agentAction('Tạm dừng'); await field(main(), 'Lọc agent theo trạng thái').selectOption('paused');
        await visible(agentRow(agentName).getByText('Tạm dừng', { exact: true }));
      }),
      step('archive', 'Agent xuất hiện trong bộ lọc Lưu trữ.', async () => {
        const owner = (await getAgents()).agents.find(agent => agent.name === agentName);
        assert.ok(owner, 'Không tìm được agent để gắn việc mẫu trước thử xóa.');
        await createTask(api, project, { code: 'AU-101', title: 'Việc giữ lịch sử agent', ownerSeatId: owner.id });
        await agentAction('Lưu trữ'); await saveDialog(page, 'Lưu trữ');
        await field(main(), 'Lọc agent theo trạng thái').selectOption('archived');
        await visible(agentRow(agentName).getByText('Lưu trữ', { exact: true }));
      }),
      step('delete-refusal', 'Hộp thoại giữ mở và báo từ chối do agent có lịch sử.', async () => {
        await agentAction('Xóa'); await button(modal(), 'Xóa').click();
        await visible(modal().getByRole('alert').filter({ hasText: /archive it instead|có lịch sử|đã từng chạy/i }));
      }),
    ] },
    { id: 'team', steps: [
      step('create', 'Đội mới xuất hiện.', async () => {
        await go('project-agents'); await button(main(), 'Tạo đội').click(); await field(modal(), 'Tên').fill(teamName);
        await saveDialog(page); await visible(teamRow(teamName));
      }),
      step('edit', 'Đội có tên mới.', async () => {
        await button(teamRow(teamName), 'Sửa').click(); await field(modal(), 'Tên').fill(editedTeam);
        await saveDialog(page); await visible(teamRow(editedTeam));
      }),
      step('delete', 'Sau xác nhận, đội biến mất.', async () => {
        await button(teamRow(editedTeam), 'Xóa').click(); await saveDialog(page, 'Xóa'); await hidden(teamRow(editedTeam));
      }),
    ] },
    { id: 'relation', steps: [
      step('add-save', 'Quan hệ Quản lý được lưu và xuất hiện sau khi mở lại.', async () => {
        await go('project-agents'); await button(relationSection(), 'Thêm quan hệ').click();
        const row = relationTable().getByRole('row').last();
        await row.getByLabel(/^Agent nguồn/).selectOption(fixture.agents.primary);
        await row.getByLabel(/^Agent đích/).selectOption(fixture.agents.fresh);
        await row.getByLabel(/^Loại quan hệ/).selectOption('manages');
        await button(relationSection(), 'Lưu').click();
        await page.getByText('Đã lưu thay đổi.', { exact: true }).first().waitFor();
        await go('project-agents');
        const saved = relationTable().getByLabel(/^Loại quan hệ/).last();
        await visible(saved); assert.equal(await saved.inputValue(), 'manages');
      }),
      step('cycle-refusal', 'Quan hệ ngược bị từ chối vì tạo chu trình.', async () => {
        await button(relationSection(), 'Thêm quan hệ').click();
        const row = relationTable().getByRole('row').last();
        await row.getByLabel(/^Agent nguồn/).selectOption(fixture.agents.fresh);
        await row.getByLabel(/^Agent đích/).selectOption(fixture.agents.primary);
        await row.getByLabel(/^Loại quan hệ/).selectOption('manages');
        await button(relationSection(), 'Lưu').click();
        await visible(relationSection().getByRole('alert').filter({ hasText: /cycle|chu trình|vòng lặp/i }));
      }),
    ] },
    { id: 'skill', steps: [
      step('create', 'Skill mới xuất hiện ở v1.', async () => {
        await go('library'); await button(main(), 'Tạo skill').click();
        await field(modal(), 'Tên').fill(skillName); await field(modal(), 'Mô tả').fill('Skill dùng thử');
        await field(modal(), 'Nội dung').fill('# Bản đầu'); await saveDialog(page);
        await visible(entry(skillName).getByText('Mới nhất: v1', { exact: true }));
      }),
      step('edit', 'Đổi mô tả không tạo phiên bản nội dung mới.', async () => {
        await entry(skillName).click(); await button(main(), 'Sửa').click();
        await field(modal(), 'Mô tả').fill('Skill đã sửa mô tả'); await saveDialog(page);
        await visible(entry(skillName).getByText('Skill đã sửa mô tả', { exact: true }));
        await visible(entry(skillName).getByText('Mới nhất: v1', { exact: true }));
      }),
      step('new-version', 'Sửa nội dung tạo v2.', async () => {
        await button(main(), 'Sửa').click(); await field(modal(), 'Nội dung').fill('# Bản thứ hai');
        await saveDialog(page); await visible(entry(skillName).getByText('Mới nhất: v2', { exact: true }));
      }),
      step('delete', 'Skill biến mất khỏi danh sách.', async () => {
        await button(main(), 'Xóa').click(); await saveDialog(page, 'Xóa'); await hidden(entry(skillName));
      }),
    ] },
    { id: 'template', steps: [
      step('create', 'Mẫu mới xuất hiện.', async () => {
        await go('library-templates'); await button(main(), 'Tạo mẫu').click();
        await field(modal(), 'Tên').fill(templateName); await field(modal(), 'Vai trò').fill('Kiểm thử');
        await saveDialog(page); await visible(entry(templateName));
      }),
      step('edit', 'Tên mới của mẫu xuất hiện.', async () => {
        await entry(templateName).click(); await button(main(), 'Sửa').click(); await field(modal(), 'Tên').fill(editedTemplate);
        await saveDialog(page); await visible(entry(editedTemplate));
      }),
      step('delete', 'Mẫu biến mất khỏi thư viện.', async () => {
        await button(main(), 'Xóa').click(); await saveDialog(page, 'Xóa'); await hidden(entry(editedTemplate));
      }),
    ] },
    { id: 'flow', steps: [
      step('create-blank', 'Trình sửa hiển thị Khởi động và Kết quả.', async () => {
        await go('project-flows'); await button(main(), 'Tạo quy trình').click();
        await field(modal(), 'Tiêu đề').fill(flowTitle); await field(modal(), 'Mã').fill('audit-ui-flow');
        await saveDialog(page, 'Tạo quy trình'); await visible(heading(page, flowTitle));
        flowId = new URL(page.url()).hash.split('/').at(-1);
        await visible(page.locator('.react-flow__node[data-id="trigger"]'));
        await visible(page.locator('.react-flow__node[data-id="output"]'));
      }),
      step('add-nodes', 'Nút Agent và nút phê duyệt xuất hiện trên sơ đồ.', async () => {
        await button(main(), /^Agent Giao việc/).click();
        await visible(page.locator('.react-flow__node[data-id="agent"]'));
        await button(main(), /^Phê duyệt Chờ phê duyệt/).click();
        await visible(page.locator('.react-flow__node[data-id="approval"]'));
        await field(main(), 'Tiêu đề').fill('Duyệt luồng thao tác audit');
      }),
      step('connect', 'Ba cạnh tạo luồng Khởi động → Agent → Phê duyệt → Kết quả.', async () => {
        const direct = page.locator('.react-flow__edge[aria-label="trigger:out → output"]');
        await direct.focus(); await page.keyboard.press('Enter');
        await button(main(), 'Xóa').click();
        await hidden(direct);
        await connect(page, 'trigger', 'out', 'agent');
        await connect(page, 'agent', 'out', 'approval');
        await connect(page, 'approval', 'approved', 'output');
      }),
      step('save-draft', 'Nhãn Chưa lưu biến mất.', async () => {
        await button(main(), 'Lưu bản nháp').click(); await hidden(main().getByText('Chưa lưu', { exact: true }));
      }),
      step('publish', 'Nút Chạy khả dụng sau khi xuất bản.', async () => {
        await button(main(), 'Xuất bản').click();
        await visible(button(main(), 'Chạy').and(page.locator(':enabled')));
      }),
      step('test', 'Lượt chạy thử bằng agent giả chờ quyết định.', async () => {
        await button(main(), 'Chạy thử').click(); await modal().getByRole('checkbox', { name: 'Agent giả (không tốn token)' }).check();
        await saveDialog(page, 'Bắt đầu chạy');
        await page.waitForFunction(() => /\/runs\/[^/]+$/.test(location.hash)); runId = new URL(page.url()).hash.split('/').at(-1);
        await visible(page.locator('#factory-main header').getByText('Đang chờ', { exact: true }).first());
      }),
      step('approve', 'Quyết định biến mất khỏi Cần xử lý sau khi xác nhận Duyệt.', async () => {
        const run = await waitForRun(api, project, runId, result => result.nodeRuns.some(node => node.approvalId));
        assert.equal(run.run.flowId, flowId);
        const approvalId = run.nodeRuns.find(node => node.approvalId).approvalId;
        await go('attention'); await approvalRow(page, approvalId).click();
        await page.getByRole('radio', { name: /^Duyệt/ }).click(); await page.locator('[data-attention-primary]').click();
        await button(main(), 'Xác nhận').click(); await hidden(approvalRow(page, approvalId));
      }),
      step('succeeded', 'Lượt chạy vừa duyệt hiển thị Thành công.', async () => {
        await waitForRun(api, project, runId, result => result.run.state === 'succeeded');
        await go('project-flows');
        await button(main(), /Quy trình thao tác audit.*Thành công/).click();
        await page.waitForFunction(id => location.hash.endsWith(`/runs/${id}`), runId);
        await visible(page.locator('#factory-main header').getByText('Thành công', { exact: true }).first());
      }),
    ] },
    { id: 'task', steps: [
      step('create', 'Công việc tạo qua Việc mới xuất hiện trên Bảng việc.', async () => {
        await go('project-board'); await createMenu(page, 'Việc mới');
        const form = main().locator('form').filter({ has: field(page, 'Tiêu chí nghiệm thu') });
        await field(form, 'Tiêu đề').fill('Việc thao tác audit'); await field(form, 'Mục tiêu').fill('Kiểm tra bảng việc');
        await field(form, 'Tiêu chí nghiệm thu').fill('Việc xuất hiện trên bảng');
        await button(form, 'Tạo công việc').click();
        await hidden(form); await visible(main().locator('[data-task-id]').getByText('Việc thao tác audit', { exact: true }));
      }),
    ] },
  ];
}

export async function runCrudFlows({ page, fixture, base, results, screenshot, safeText }) {
  for (const scenario of scenarios(page, fixture, base)) {
    let blocked = false;
    for (const [index, item] of scenario.steps.entries()) {
      const result = { flow: scenario.id, name: item.name, expected: item.expected, status: blocked ? 'SKIP' : 'PASS' };
      results.push(result);
      if (blocked) continue;
      try { await item.run(); }
      catch (error) {
        blocked = true;
        result.status = 'FAIL'; result.error = safeText(error.message);
        try { result.file = await screenshot(`crud-${scenario.id}-${index + 1}-${item.name}-1280-light.png`); }
        catch (captureError) { result.error += ` · Không chụp được ảnh: ${safeText(captureError.message)}`; }
      }
    }
  }
}
