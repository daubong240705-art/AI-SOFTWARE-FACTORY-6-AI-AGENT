import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function CsvPreview({ data }: { data: ArrayBuffer }) {
  const [rows, setRows] = useState<string[][]>([]);
  useEffect(() => { const parsed = Papa.parse<string[]>(new TextDecoder().decode(data), { skipEmptyLines: true }).data; setRows(parsed.slice(0, 1001)); }, [data]);
  const columns = Math.max(0, ...rows.map(row => row.length));
  return <div className="space-y-3">{rows.length > 1000 && <p className="text-xs text-muted-foreground">Showing the first 1,000 rows</p>}<Table><TableHeader><TableRow>{Array.from({ length: columns }, (_, index) => <TableHead key={index}>{rows[0]?.[index] ?? ''}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(1, 1001).map((row, index) => <TableRow key={index}>{Array.from({ length: columns }, (_, column) => <TableCell key={column}>{row[column] ?? ''}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
