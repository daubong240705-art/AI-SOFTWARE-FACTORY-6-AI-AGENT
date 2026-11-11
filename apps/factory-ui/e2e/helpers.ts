import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export async function hostInfo(): Promise<{ port: number; token: string }> {
  const raw: unknown = JSON.parse(await readFile(new URL('./.run/host.json', import.meta.url), 'utf8'));
  if (!raw || typeof raw !== 'object' || !('port' in raw) || typeof raw.port !== 'number'
    || !('token' in raw) || typeof raw.token !== 'string') throw new Error('Invalid E2E Host metadata.');
  return { port: raw.port, token: raw.token };
}

// The app defaults to Vietnamese and the dark theme. The existing scenarios were written for English and the light theme:
// store that preference only when the page has none, so the scenarios that change and reload it still work.
export const englishLight = () => {
  if (!localStorage.getItem('factory-ui.preferences.v1')) localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ locale: 'en', theme: 'light' }));
};

// Theme and language live in the Settings popover of the sidebar: open it only when the field is not already visible.
export async function preference(page: Page, label: string): Promise<Locator> {
  const field = page.getByRole('combobox', { name: label, exact: true });
  if (!(await field.isVisible())) await page.getByRole('button', { name: /^(Settings|Cài đặt)$/ }).click();
  return field;
}

export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

export async function signIn(page: Page, keyboard = false): Promise<void> {
  await page.goto('/');
  const field = page.getByLabel('Bootstrap token', { exact: true });
  await expect(field).toBeEnabled();
  const { token } = await hostInfo();
  if (keyboard) {
    await tabTo(page, field);
    await page.keyboard.insertText(token);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await field.fill(token);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
}

export async function shot(page: Page, name: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Screenshot name must be a simple slug.');
  const directory = new URL('./screenshots/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, directory)), fullPage: true,
    animations: 'disabled', style: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
}
