import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { i18n, useT } from '@/i18n';

export function PdfPreview({ data, initialPage, onPageChange }: { data: ArrayBuffer; initialPage?: number; onPageChange?: (page: number) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; let task: PDFDocumentLoadingTask | undefined;
    setPdf(null); setError(false);
    void import('pdfjs-dist').then(pdfjs => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const options = { data: data.slice(0), isEvalSupported: false };
      task = pdfjs.getDocument(options);
      return task.promise;
    }).then(value => { if (active && value) setPdf(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy(); };
  }, [data]);
  useEffect(() => { if (initialPage !== undefined) setPage(Math.max(1, initialPage)); }, [initialPage]);
  const currentPage = Math.min(page, pdf?.numPages ?? page);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true; let task: RenderTask | undefined;
    void pdf.getPage(currentPage).then(current => {
      const target = canvas.current;
      if (!active || !target) return;
      const viewport = current.getViewport({ scale });
      target.width = viewport.width; target.height = viewport.height;
      const context = target.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      task = current.render({ canvas: target, canvasContext: context, viewport });
      return task.promise;
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; task?.cancel(); };
  }, [pdf, currentPage, scale]);
  function changePage(next: number) { setPage(next); onPageChange?.(next); }
  if (error) return <Alert className="border-border"><AlertDescription>{t('knowledgeUi.previewError')}</AlertDescription></Alert>;
  if (!pdf) return <Skeleton role="status" aria-label={t('viewStates.loading')} className="h-64 rounded-lg" />;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-center gap-2">
    <Button size="sm" variant="outline" aria-label={t('knowledgeUi.previousPage')} disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft className="size-4" /></Button>
    <span className="text-sm">{t('knowledgeUi.page').replace('{page}', number(currentPage)).replace('{count}', number(pdf.numPages))}</span>
    <Button size="sm" variant="outline" aria-label={t('knowledgeUi.nextPage')} disabled={currentPage >= Math.min(pdf.numPages, 500)} onClick={() => changePage(currentPage + 1)}><ChevronRight className="size-4" /></Button>
    <Button size="sm" variant="ghost" aria-label={t('knowledgeUi.zoomOut')} onClick={() => setScale(value => Math.max(.5, value - .2))}><Minus className="size-4" /></Button><span className="text-xs text-muted-foreground">{number(Math.round(scale * 100))}%</span>
    <Button size="sm" variant="ghost" aria-label={t('knowledgeUi.zoomIn')} onClick={() => setScale(value => value + .2)}><Plus className="size-4" /></Button>
  </div><div className="max-h-[65dvh] overflow-auto rounded-lg border border-border bg-muted/20 p-3"><canvas ref={canvas} className="mx-auto max-w-full" /></div>{pdf.numPages > 500 && <p className="text-xs text-muted-foreground">{t('knowledgeUi.pdfLimit')}</p>}</div>;
}
