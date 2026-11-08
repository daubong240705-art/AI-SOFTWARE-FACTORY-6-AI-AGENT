export type DiffLine = { kind: 'context' | 'added' | 'removed' | 'hunk' | 'marker'; text: string; oldLine?: number; newLine?: number };
export type DiffFile = { name: string; markers: string[]; lines: DiffLine[] };
// Bound parsing as well as rendering. The source patch is already capped by the API.
export const MAX_DIFF_LINES = 100_000;
export function parseDiff(patch: string): { files: DiffFile[]; truncated: boolean } {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let index = 0;
  let count = 0;
  while (index < patch.length && count < MAX_DIFF_LINES) {
    const end = patch.indexOf('\n', index);
    const line = patch.slice(index, end < 0 ? patch.length : end).replace(/\r$/, '');
    index = end < 0 ? patch.length : end + 1;
    count++;
    if (line.startsWith('diff --git ')) {
      file = { name: line.slice(11), markers: [], lines: [] }; files.push(file); oldLine = undefined; newLine = undefined;
      continue;
    }
    if (!file) { file = { name: '', markers: [], lines: [] }; files.push(file); }
    if (/^(new file mode|deleted file mode|rename from|rename to|similarity index|Binary files|GIT binary patch)/.test(line)) {
      file.markers.push(line); file.lines.push({ kind: 'marker', text: line }); continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (hunk && Number.isSafeInteger(Number(hunk[1])) && Number.isSafeInteger(Number(hunk[3]))) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[3]); file.lines.push({ kind: 'hunk', text: line }); continue;
    }
    if (line.startsWith('\\ No newline at end of file')) { file.lines.push({ kind: 'marker', text: line }); continue; }
    const numbered = oldLine !== undefined && newLine !== undefined;
    if (numbered && line.startsWith('+')) file.lines.push({ kind: 'added', text: line.slice(1), newLine: newLine!++ });
    else if (numbered && line.startsWith('-')) file.lines.push({ kind: 'removed', text: line.slice(1), oldLine: oldLine!++ });
    else if (numbered && line.startsWith(' ')) file.lines.push({ kind: 'context', text: line.slice(1), oldLine: oldLine!++, newLine: newLine!++ });
    else file.lines.push({ kind: 'context', text: line });
  }
  return { files, truncated: index < patch.length };
}
