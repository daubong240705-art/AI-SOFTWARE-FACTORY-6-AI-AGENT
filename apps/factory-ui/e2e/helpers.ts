import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export async function hostInfo(): Promise<{ port: number; token: string }> {
  const raw: unknown = JSON.parse(await readFile(new URL('./.run/host.json', import.meta.url), 'utf8'));
  if (!raw || typeof raw !== 'object' || !('port' in raw) || typeof raw.port !== 'number'
    || !('token' in raw) || typeof raw.token !== 'string') throw new Error('Invalid E2E Host metadata.');
  return { port: raw.port, token: raw.token };
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
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}

export async function shot(page: Page, name: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Screenshot name must be a simple slug.');
  const directory = new URL('./screenshots/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, directory)), fullPage: true });
}
