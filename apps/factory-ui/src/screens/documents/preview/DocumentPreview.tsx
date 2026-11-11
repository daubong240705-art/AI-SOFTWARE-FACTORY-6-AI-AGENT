import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { KnowledgeArtifact, KnowledgeItem } from '@/api/readModels';
import type { Store } from '@/state/store';
import { MAX_PREVIEW_BYTES } from '@/api/documents';
import { documentType } from '../presentation';
import { CsvPreview } from './CsvPreview';
import { DocxPreview } from './DocxPreview';
import { PdfPreview } from './PdfPreview';
import { SpreadsheetPreview } from './SpreadsheetPreview';
import { TextPreview } from './TextPreview';

export function DocumentPreview({ store, projectId, artifact, version }: { store: Store; projectId: string; artifact: KnowledgeArtifact | KnowledgeItem; version: KnowledgeArtifact['versions'][number] }) {
  const type = documentType(version.mediaType);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (type === 'image' || type === 'svg' || type === 'pptx' || (version.sizeBytes > MAX_PREVIEW_BYTES && type !== 'pdf')) return;
    let active = true; setData(null); setError(false);
    void store.fetchRawDocument(projectId, artifact.artifactId, version.version).then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [store, projectId, artifact.artifactId, version.version, version.sizeBytes, type]);
  if (type === 'svg') return <p className="text-sm text-muted-foreground">SVG files are available to download.</p>;
  if (type === 'pptx') return <p className="text-sm text-muted-foreground">PowerPoint preview is not supported yet. Please download it.</p>;
  if (type === 'image') return <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-muted/20 p-4"><img src={store.rawDocumentUrl(projectId, artifact.artifactId, version.version)} alt={artifact.title} className="max-h-[65dvh] max-w-full object-contain" /></div>;
  if (version.sizeBytes > MAX_PREVIEW_BYTES && type !== 'pdf') return <p className="text-sm text-muted-foreground">Files over 15 MB are available to download.</p>;
  if (error) return <Alert variant="destructive"><AlertDescription>Cannot preview this file. Please download it.</AlertDescription></Alert>;
  if (!data) return <Skeleton role="status" className="h-64 w-full" />;
  if (type === 'pdf') return <PdfPreview data={data} />;
  if (type === 'docx') return <DocxPreview data={data} />;
  if (type === 'xlsx') return <SpreadsheetPreview data={data} />;
  if (type === 'csv') return <CsvPreview data={data} />;
  return <TextPreview data={data} type={type} />;
}
