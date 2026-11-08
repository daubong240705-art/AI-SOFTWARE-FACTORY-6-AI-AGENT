import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

// Real Host in WSL (see playwright.work.config.ts / e2e/work-host.mjs). The model is a scripted local fake; everything
// else is real: Host, SQLite, git clone + worktree, bubblewrap sandbox, OpenCode, proxy, MCP, approvals, push.
const token = process.env.E2E_WORK_TOKEN ?? '';
const cloneRoot = process.env.E2E_WORK_CLONE ?? '/home/lazy/factory-v2/e2e-work/projects/demo';
const remoteGit = process.env.E2E_WORK_REMOTE ?? '/home/lazy/factory-v2/e2e-work/remote.git';

async function shot(page: Page, name: string) {
  const directory = new URL('../screenshots/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`work-${name}.png`, directory)), fullPage: true, animations: 'disabled',
    style: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
}
const remoteBranches = () => execFileSync('wsl.exe', ['-e', 'git', '-C', remoteGit, 'branch', '--list'], { encoding: 'utf8' }).replaceAll('\r', '').split('\n').map((line) => line.trim()).filter(Boolean);

test.describe.serial('daily loop with a real Host, sandbox and OpenCode', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    expect(token, 'E2E_WORK_TOKEN must be set').not.toBe('');
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => { await page.context().close(); });

  async function createTask(title: string, goal: string) {
    await page.getByRole('tab', { name: /^Tasks/ }).click();
    await page.getByRole('group', { name: 'Task views', exact: true }).getByRole('button', { name: 'List', exact: true }).click();
    // The form stays open after a task was created: only open it when it is closed.
    if (!(await page.getByLabel('Title', { exact: true }).isVisible())) await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Goal', { exact: true }).fill(goal);
    await page.getByLabel('Acceptance criteria', { exact: true }).fill('AGENT-NOTES.md exists');
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(row).toBeVisible();
    return row;
  }
  async function acceptAndOpen(title: string) {
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    if (await row.getByRole('button', { name: 'Propose', exact: true }).count()) await row.getByRole('button', { name: 'Propose', exact: true }).click();
    await row.getByRole('button', { name: 'Accept', exact: true }).click();
    await page.getByRole('group', { name: 'Task views', exact: true }).getByRole('button', { name: 'Board', exact: true }).click();
  }
  async function openTask(title: string) {
    await page.getByRole('button', { name: new RegExp(title) }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('sign in and import the git clone as a project', async () => {
    await page.goto('/');
    await page.getByLabel('Bootstrap token', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Create project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
    await dialog.getByLabel('Project name', { exact: true }).fill('Demo project');
    await dialog.getByRole('radio', { name: 'Git project (existing clone)', exact: true }).check();
    await dialog.getByLabel('Path of existing clone', { exact: true }).fill(cloneRoot);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Demo project', exact: true })).toBeVisible();
    await shot(page, '01-project');
  });

  test('create, accept and start a task; the agent works in the sandbox and the task reaches review', async () => {
    await createTask('Write the agent notes', 'Write AGENT-NOTES.md');
    await acceptAndOpen('Write the agent notes');
    await shot(page, '02-board-ready');
    await openTask('Write the agent notes');
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('group', { name: 'Confirm task action', exact: true }).getByRole('button').first().click();
    await shot(page, '03-started');
    await page.getByRole('tab', { name: 'Progress', exact: true }).click();
    await expect(page.getByText('Notes written and registered').first()).toBeVisible({ timeout: 120_000 });
    await shot(page, '04-progress');
  });

  test("results show the registered deliverable and the diff of the agent work", async () => {
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await expect(page.getByText("Agent notes").first()).toBeVisible();
    await expect(page.getByText("Notes written by the agent.").first()).toBeVisible();
    await page.getByRole("button", { name: "View patch" }).first().click();
    await expect(page.getByText("AGENT-NOTES.md").first()).toBeVisible();
    await expect(page.getByText("Written by the agent inside the sandbox.").first()).toBeVisible();
    await shot(page, "05-results-diff");
    await page.getByRole("button", { name: "Close task", exact: true }).click();
  });

  test("the Inbox badge leads to the review; accepting finishes the task", async () => {
    const inbox = page.getByRole("button", { name: /^Inbox/ }).first();
    await expect(inbox).toBeVisible();
    await inbox.click();
    const list = page.getByRole("dialog");
    await expect(list.getByText("Write the agent notes").first()).toBeVisible();
    await shot(page, "06-inbox");
    await list.getByRole("button", { name: "Review", exact: true }).first().click();
    const decision = page.getByRole("dialog").last();
    await expect(decision.getByText("Accept").first()).toBeVisible();
    await shot(page, "07-decision");
    await decision.getByRole("radio", { name: /Accept/ }).check();
    await decision.getByRole("button", { name: "Decide", exact: true }).click();
    await decision.getByRole("group", { name: "Confirm task action", exact: true }).getByRole("button").first().click();
    await expect(page.getByText("Decision recorded.").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); // the Inbox list stays open after a decision
  });

  test("the accepted branch can be pushed to the configured remote, and only that branch", async () => {
    expect(remoteBranches()).toEqual([]);
    await page.getByRole("button", { name: /Write the agent notes/ }).first().click();
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await expect(page.getByLabel("Remote name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Remote name", { exact: true })).toHaveValue("backup");
    await page.getByRole("button", { name: "Push", exact: true }).click();
    const confirm = page.getByRole("group", { name: "Confirm task action", exact: true });
    await expect(confirm).toContainText("never forces and never touches main");
    await shot(page, "08-push-confirm");
    await confirm.getByRole("button").first().click();
    await expect(page.getByText(/backup · Pushed/)).toBeVisible({ timeout: 30_000 });
    await shot(page, "09-pushed");
    expect(remoteBranches().filter((name) => name.startsWith("factory/"))).toHaveLength(1);
    expect(remoteBranches().filter((name) => !name.startsWith("factory/"))).toEqual([]);
    await page.getByRole("button", { name: "Close task", exact: true }).click();
  });

  test("the agent asks a business question, the attempt parks, the answer resumes the work", async () => {
    await createTask("Write notes after a question", "ASK-ME which format to use");
    await acceptAndOpen("Write notes after a question");
    await openTask("Write notes after a question");
    await page.getByRole("tab", { name: "Actions", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("group", { name: "Confirm task action", exact: true }).getByRole("button").first().click();
    await page.getByRole("button", { name: "Close task", exact: true }).click();
    // The agent asks; the question reaches the Inbox while the attempt is parked.
    await page.getByRole("button", { name: /^Inbox/ }).first().click();
    const list = page.getByRole("dialog");
    await expect(list.getByText("Which format should the notes use?").first()).toBeVisible({ timeout: 90_000 });
    await shot(page, "10-question-inbox");
    await list.getByRole("button", { name: "Answer", exact: true }).first().click();
    const decision = page.getByRole("dialog").last();
    await expect(decision.getByText("Recommended").first()).toBeVisible();
    await shot(page, "11-question");
    await decision.getByRole("radio", { name: /Short/ }).check();
    await decision.getByLabel("Comment").fill("Keep it short please.");
    await decision.getByRole("button", { name: "Decide", exact: true }).click();
    await decision.getByRole("group", { name: "Confirm task action", exact: true }).getByRole("button").first().click();
    await expect(page.getByText("Decision recorded.").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); // the Inbox list stays open after a decision
    // A new attempt starts with the decision in its handoff and finishes in review.
    await openTask("Write notes after a question");
    await page.getByRole("tab", { name: "Progress", exact: true }).click();
    await expect(page.getByRole("button", { name: /Attempt 2/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Lifecycle: In review/)).toBeVisible({ timeout: 90_000 });
    await shot(page, "12-after-answer");
    await page.getByRole("button", { name: "Close task", exact: true }).click();
  });

  test("Vietnamese, dark theme and a phone-sized screen keep the screens usable", async () => {
    await page.getByLabel("Language", { exact: true }).selectOption({ label: "Tiếng Việt" });
    await page.getByLabel(/Giao diện|Theme/).selectOption({ index: 1 });
    await page.getByRole("button", { name: /Write notes after a question/ }).first().waitFor();
    await shot(page, "13-vietnamese-dark-board");
    await page.getByRole("button", { name: /^Inbox|Hộp thư/ }).first().click();
    await shot(page, "14-vietnamese-dark-inbox");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole("button", { name: /Write notes after a question/ }).first().click();
    await shot(page, "15-mobile-detail");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
