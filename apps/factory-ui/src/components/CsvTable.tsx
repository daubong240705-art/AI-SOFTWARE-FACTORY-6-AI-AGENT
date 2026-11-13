import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** RFC 4180 parsing: quoted fields, doubled quotes, commas and newlines inside quotes. Cells stay plain text. */
export function parseCsv(text: string, maxRows = 1000): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows.length > maxRows ? { rows: rows.slice(0, maxRows), truncated: true } : { rows, truncated: false };
}

export function CsvTable({ text, truncatedLabel, maxRows = 1000 }: { text: string; truncatedLabel: string; maxRows?: number }) {
  const { rows, truncated } = parseCsv(text, maxRows + 1);
  const [header = [], ...body] = rows;
  const width = Math.max(header.length, ...body.map(row => row.length));
  const cells = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? '');
  return <div className="max-h-96 overflow-auto rounded-lg border border-border bg-background">
    <Table className="text-sm">
      <TableHeader><TableRow>{cells(header).map((cell, index) => <TableHead key={index} className="whitespace-normal">{cell}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{body.map((row, rowIndex) => <TableRow key={rowIndex}>{cells(row).map((cell, index) => <TableCell key={index} className="align-top whitespace-pre-wrap [overflow-wrap:anywhere]">{cell}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
    {truncated && <p className="border-t border-border p-2 text-xs text-muted-foreground">{truncatedLabel}</p>}
  </div>;
}
