// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import tokens from '../../../design/factory-v2/tokens.json';
import { buildTokens, renderTokens } from '../scripts/build-tokens.mjs';

it('renders both themes, matching custom property names, and the font face', () => {
  const css = renderTokens(tokens); expect(css).toContain(':root, [data-theme="light"]'); expect(css).toContain('[data-theme="dark"]');
  expect(css).toContain('--color-control-border:'); expect(css).toContain('--type-body-line-height: 20px'); expect(css).toContain('--size-sidebar-collapsed:');
  expect(css).toContain('@font-face'); expect(css).toContain('font-display: swap'); expect(css).toContain("url('/fonts/InterVariable.woff2')");
});
it('output is deterministic', () => { expect(renderTokens(structuredClone(tokens))).toBe(renderTokens(tokens)); });
it.each([null, {}, { ...tokens, schemaVersion: 1 }, { ...tokens, themes: {} }, { ...tokens, spacing: { xs: '4px' } }, { ...tokens, fonts: { body: 'x; } malicious' } }, { ...tokens, typography: { body: { size: 14 } } }])('invalid tokens %# fail clearly', (input) => {
  expect(() => renderTokens(input)).toThrow(/Invalid tokens.json/);
});
it('copies the exact pinned font and license and writes CSS into an isolated output', () => {
  const output = mkdtempSync(join(tmpdir(), 'factory-ui-tokens-'));
  const source = fileURLToPath(new URL('../../../design/factory-v2', import.meta.url)); buildTokens({ source, output });
  expect(readFileSync(join(output, 'src/styles/tokens.css'), 'utf8')).toBe(renderTokens(tokens));
  expect(readFileSync(join(output, 'public/fonts/InterVariable.woff2'))).toEqual(readFileSync(join(source, 'assets/InterVariable.woff2')));
  expect(readFileSync(join(output, 'public/fonts/Inter-LICENSE.txt'))).toEqual(readFileSync(join(source, 'assets/Inter-LICENSE.txt')));
});
it('invalid JSON fails before any output is written', () => {
  const source = mkdtempSync(join(tmpdir(), 'factory-ui-invalid-')); const output = join(source, 'output'); mkdirSync(output); writeFileSync(join(source, 'tokens.json'), '{');
  expect(() => buildTokens({ source, output })).toThrow('Invalid tokens.json: cannot read or parse JSON.');
});
