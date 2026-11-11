import { useEffect, useState } from 'react';
import readExcelFile from 'read-excel-file/browser';
import { Select } from '@/components/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function SpreadsheetPreview({ data }: { data: ArrayBuffer }) {
  const [sheets, setSheets] = useState<Array<{ sheet: string; data: Array<Array<string | number | boolean | Date | null>> }>>([]); const [selected, setSelected] = useState('');
  useEffect(() => { let active = true; void readExcelFile(data).then(value => { if (active) { setSheets(value as unknown as Array<{ sheet: string; data: Array<Array<string | number | boolean | Date | null>> }>); setSelected(value[0]?.sheet ?? ''); } }).catch(() => setSheets([])); return () => { active = false; }; }, [data]);
  const sheet = sheets.find(item => item.sheet === selected) ?? sheets[0]; const rows = (sheet?.data ?? []).slice(0, 1001); const columns = Math.min(50, Math.max(0, ...rows.map(row => row.length)));
  if (!sheet) return <p className="text-sm text-muted-foreground">Cannot preview this file. Please download it.</p>;
  return <div className="space-y-3">{sheets.length > 1 && <Select aria-label="Worksheet" value={selected} onValueChange={setSelected} options={sheets.map(item => ({ value: item.sheet, label: item.sheet }))} />}<p className="text-xs text-muted-foreground">{rows.length > 1000 ? 'Showing the first 1,000 rows' : ''}{columns >= 50 ? ' Showing up to 50 columns' : ''}</p><Table><TableHeader><TableRow>{Array.from({ length: columns }, (_, index) => <TableHead key={index}>{String(rows[0]?.[index] ?? '')}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(1).map((row, index) => <TableRow key={index}>{Array.from({ length: columns }, (_, column) => <TableCell key={column}>{String(row[column] ?? '')}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
