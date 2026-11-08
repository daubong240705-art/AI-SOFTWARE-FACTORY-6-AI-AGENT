import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { summariseEvent, evidenceView, cleanText } from '../src/state/attemptView';
import { MAX_DIFF_LINES, parseDiff } from '../src/state/diff';
import { DiffView } from '../src/screens/DiffView';
import { i18n } from '../src/i18n';
import type { AttemptEvent } from '../src/api/client';

afterEach(() => { cleanup(); i18n.setLocale('en'); });
it.each([null, [], ['text'], 4, true, { message: {} }, { message: ['text'] }, { message: null }])('ignores malformed progress body %#', body => {
  expect(summariseEvent({ kind: 'progress', body })).toEqual({ kind: 'progress', text: '' });
});
it('supports the workspace progress variant', () => { expect(summariseEvent({ kind: 'progress', body: { type: 'progress', message: 'Working', percent: 25 } })).toEqual({ kind: 'progress', text: 'Working', percent: 25 }); });
it.each([-1, 101, Infinity, NaN, '30', {}, null])('ignores invalid percentage %#', percent => { expect(summariseEvent({ kind: 'progress', body: { message: 'Work', percent } })).toEqual({ kind: 'progress', text: 'Work' }); });
it.each([0, 0.5, 100])('keeps valid percentage %s', percent => { expect(summariseEvent({ kind: 'progress', body: { percent } }).percent).toBe(percent); });
it.each(['summary', 'message', 'reason', 'to'])('summarises state %s', field => { expect(summariseEvent({ kind: 'state', body: { [field]: 'State text' } }).text).toBe('State text'); });
it('state summary takes priority over transport detail', () => { expect(summariseEvent({ kind: 'state', body: { summary: 'Safe summary', message: 'Other', to: 'failed' } }).text).toBe('Safe summary'); });
it.each(['name', 'detail'])('summarises evidence %s', field => { expect(summariseEvent({ kind: 'evidence', body: { [field]: 'Runtime evidence' } }).text).toBe('Runtime evidence'); });
it.each(['output', 'question', 'usage'] as const)('keeps %s messages as text', kind => { expect(summariseEvent({ kind, body: { message: '<script>text</script>' } }).text).toBe('<script>text</script>'); });
it.each(['progress', 'state', 'evidence', 'output', 'question', 'usage'] satisfies AttemptEvent['kind'][])('caps and strips controls for %s', kind => {
  const result = summariseEvent({ kind, body: { message: '\u0000\u0007\n\t\u007f\u009f' + 'x'.repeat(9000), detail: 'x'.repeat(9000) } });
  expect(result.text).toHaveLength(300); expect(result.text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
});
it('cleanText never serialises nested objects', () => { expect(cleanText({ secret: 'data' })).toBe(''); });
it('evidence validates totals and file shapes independently', () => {
  expect(evidenceView({ files: [{ path: 'a\n.ts', status: 'M' }, null, { path: {} }], totals: { files: 1, additions: 2, deletions: 3 } })).toEqual({ files: [{ path: 'a.ts', status: 'M' }], totals: { files: 1, additions: 2, deletions: 3 } });
});
it.each([null, [], { totals: { files: -1, additions: 2, deletions: 3 } }, { totals: { files: 1, additions: '2', deletions: 3 } }, { files: 'wrong' }])('handles hostile evidence %#', body => { expect(evidenceView(body)).toEqual({ files: [], totals: null }); });
it('evidence caps file counts and every string', () => { const value = evidenceView({ files: Array.from({ length: 5001 }, () => ({ path: 'x'.repeat(500), status: 'M' })) }); expect(value.files).toHaveLength(5000); expect(value.files[0]?.path).toHaveLength(300); });

const normal = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,2 +3,2 @@ function\n same\n-old\n+new\n\\ No newline at end of file\n';
it('parses a unified diff with both line numbers', () => {
  const result = parseDiff(normal); expect(result.truncated).toBe(false); expect(result.files).toHaveLength(1);
  expect(result.files[0]?.lines.slice(3)).toEqual([{ kind: 'context', text: 'same', oldLine: 2, newLine: 3 }, { kind: 'removed', text: 'old', oldLine: 3 }, { kind: 'added', text: 'new', newLine: 4 }, { kind: 'marker', text: '\\ No newline at end of file' }]);
});
it('resets numbering between files', () => {
  const result = parseDiff(normal + 'diff --git a/b b/b\n@@ -1 +9 @@\n+x'); expect(result.files).toHaveLength(2); expect(result.files[1]?.lines[1]).toEqual({ kind: 'added', text: 'x', newLine: 9 });
});
it.each(['rename from old', 'rename to new', 'similarity index 100%', 'Binary files a/x and b/x differ', 'GIT binary patch', 'new file mode 100644', 'deleted file mode 100644'])('keeps marker %s', marker => { expect(parseDiff(`diff --git a/a b/b\n${marker}`).files[0]?.markers).toContain(marker); });
it('handles new files with zero old count', () => { expect(parseDiff('@@ -0,0 +1,2 @@\n+one\n+two').files[0]?.lines.at(-1)).toEqual({ kind: 'added', text: 'two', newLine: 2 }); });
it('handles deleted files with zero new count', () => { expect(parseDiff('@@ -1,2 +0,0 @@\n-one\n-two').files[0]?.lines.at(-1)).toEqual({ kind: 'removed', text: 'two', oldLine: 2 }); });
it('preserves garbage as context without inventing numbering', () => { expect(parseDiff('garbage\n+outside\n@@ malformed').files[0]?.lines).toEqual([{ kind: 'context', text: 'garbage' }, { kind: 'context', text: '+outside' }, { kind: 'context', text: '@@ malformed' }]); });
it('empty input creates no files', () => { expect(parseDiff('')).toEqual({ files: [], truncated: false }); });
it('handles CRLF exactly like LF', () => { expect(parseDiff(normal.replace(/\n/g, '\r\n'))).toEqual(parseDiff(normal)); });
it('caps huge input during parsing', () => { const result = parseDiff('line\n'.repeat(MAX_DIFF_LINES + 5)); expect(result.files[0]?.lines).toHaveLength(MAX_DIFF_LINES); expect(result.truncated).toBe(true); });
it.each(['@@ -1 +1 @@', '@@ -1,0 +2,0 @@ title', '@@ -123,4 +999,5 @@'])('recognises hunk header %s', header => { expect(parseDiff(header).files[0]?.lines[0]?.kind).toBe('hunk'); });
it.each(['@@ -x +1 @@', '@@ -1 +x @@', '@@ -1 +1 @', '@@ -99999999999999999 +1 @@'])('tolerates broken hunk header %s', header => { expect(parseDiff(header).files[0]?.lines[0]).toEqual({ kind: 'context', text: header }); });
it('does not treat file headers outside hunks as additions', () => { expect(parseDiff('--- a\n+++ b').files[0]?.lines.map(line => line.kind)).toEqual(['context', 'context']); });
it('a no-newline marker does not increment line counters', () => { expect(parseDiff('@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y').files[0]?.lines.at(-1)).toEqual({ kind: 'added', text: 'y', newLine: 1 }); });
it('unknown lines inside a hunk remain context text', () => { expect(parseDiff('@@ -1 +1 @@\ngarbage\n+x').files[0]?.lines[1]).toEqual({ kind: 'context', text: 'garbage' }); });
it('DiffView keeps hostile HTML as text with non-colour cues', () => {
  render(<DiffView patch={'@@ -1 +1 @@\n-<script>bad</script>\n+<img src=x onerror=alert(1)>'} />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy(); expect(document.querySelector('img,script')).toBeNull(); expect(screen.getByText('Added').className).toBe('sr-only'); expect(screen.getByText('Removed').className).toBe('sr-only');
  expect(document.querySelector('.diff-added')?.textContent).toContain('+'); expect(document.querySelector('.diff-removed')?.textContent).toContain('-');
});
it('DiffView caps each file and shows more on demand', () => {
  render(<DiffView patch={'@@ -0,0 +1,6000 @@\n' + '+line\n'.repeat(6000)} />); expect(document.querySelectorAll('.diff-line')).toHaveLength(5000); fireEvent.click(screen.getByRole('button', { name: 'Show more' })); expect(document.querySelectorAll('.diff-line')).toHaveLength(6001);
});
it('DiffView caps total lines across files', () => {
  render(<DiffView patch={Array.from({ length: 5 }, (_, index) => `diff --git a/${index} b/${index}\n` + 'line\n'.repeat(5000)).join('')} />); expect(document.querySelectorAll('.diff-line')).toHaveLength(20_000); expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
});
it('DiffView closes all but the first when there are over ten files', () => {
  render(<DiffView patch={Array.from({ length: 11 }, (_, index) => `diff --git a/${index} b/${index}\nline\n`).join('')} />);
  const buttons = screen.getAllByRole('button'); expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true'); expect(buttons[1]?.getAttribute('aria-expanded')).toBe('false'); expect(document.querySelectorAll('.diff-lines')).toHaveLength(1); fireEvent.click(buttons[1]!); expect(document.querySelectorAll('.diff-lines')).toHaveLength(2);
});
it('DiffView starts with ten files open', () => { render(<DiffView patch={Array.from({ length: 10 }, (_, index) => `diff --git a/${index} b/${index}\nx\n`).join('')} />); expect(document.querySelectorAll('.diff-lines')).toHaveLength(10); });
it('DiffView collapses individual files', () => { render(<DiffView patch={normal} />); fireEvent.click(screen.getByRole('button', { name: 'a/a.ts b/a.ts' })); expect(document.querySelector('.diff-lines')).toBeNull(); });
