import { useId, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentUploadMeta } from '@/api/client';
import { documentAccept, validateDocument } from '@/api/documents';
import { knowledgeKinds } from '@/api/readModels';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';

export type UploadTarget = { artifactId: string; kind: DocumentUploadMeta['kind']; title: string };
export function UploadDialog({ store, initialFile = null, target, onClose, onUploaded }: {
  store: Store; initialFile?: File | null; target?: UploadTarget; onClose: () => void; onUploaded: (id: string) => void;
}) {
  const t = useT(); const id = useId(); const submitting = useRef(false);
  const upload = store.useStoreSelector(state => state.knowledge.upload);
  const [file, setFile] = useState<File | null>(initialFile);
  const [kind, setKind] = useState<DocumentUploadMeta['kind']>(target?.kind ?? 'other');
  const [title, setTitle] = useState(initialFile?.name.replace(/\.[^.]+$/, '').slice(0, 200) ?? target?.title ?? '');
  const validation = file ? validateDocument(file) : null;
  const error = validation ?? (upload.error ? upload.error.status === 413 ? 'size' : upload.error.status === 415 ? 'type' : upload.error.code === 'quota' ? 'quota' : upload.error.code === 'version' ? 'version' : 'generic' : null);
  const close = () => { if (!submitting.current && !upload.busy) onClose(); };
  async function submit() {
    if (!file || validation || submitting.current || upload.busy) return;
    submitting.current = true;
    try {
      const artifact = await store.uploadDocument(file, { kind, title: title.trim(), ...(target ? { artifactId: target.artifactId } : {}) });
      if (artifact) { toast.success(t('knowledgeUi.uploaded')); onUploaded(artifact.artifactId); }
    } finally { submitting.current = false; }
  }
  return <Dialog labelledBy={`${id}-title`} onClose={close} className="sm:max-w-lg">
    <header className="flex items-center justify-between gap-4"><h2 id={`${id}-title`} className="font-display text-2xl font-semibold">{t(target ? 'knowledgeUi.uploadNewVersion' : 'knowledgeUi.upload')}</h2><Button type="button" variant="ghost" size="icon" disabled={upload.busy} aria-label={t('knowledgeUi.close')} onClick={close}><X className="size-4" /></Button></header>
    <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="space-y-2"><Label htmlFor={`${id}-file`}>{t('knowledgeUi.file')}</Label><Input id={`${id}-file`} type="file" accept={documentAccept} disabled={upload.busy} aria-describedby={`${id}-help`} onChange={event => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 200)); store.resetDocumentUpload(); }} />{file && <p className="truncate text-sm" title={file.name}>{file.name}</p>}<p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">{t('knowledgeUi.uploadHelp')}</p></div>
      <div className="space-y-2"><Label htmlFor={`${id}-kind`}>{t('knowledgeUi.kind')}</Label><Select id={`${id}-kind`} value={kind} disabled={upload.busy || !!target} onValueChange={value => setKind(value as typeof kind)} options={knowledgeKinds.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))} /></div>
      <div className="space-y-2"><Label htmlFor={`${id}-name`}>{t('knowledgeUi.title')}</Label><Input id={`${id}-name`} maxLength={200} value={title} disabled={upload.busy} onChange={event => setTitle(event.target.value)} /></div>
      {upload.busy && <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">{t('knowledgeUi.uploading')} {Math.floor(upload.progress)}%</p><Progress value={upload.progress} aria-label={t('knowledgeUi.uploading')} /></div>}
      {error && <Alert><AlertDescription>{t(`knowledgeUi.uploadErrors.${error}`)}</AlertDescription></Alert>}
      <footer className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" disabled={upload.busy} onClick={close}>{t('knowledgeUi.cancel')}</Button><Button type="submit" disabled={!file || !!validation || upload.busy}><Upload className="size-4" />{t(upload.error ? 'errors.retry' : 'knowledgeUi.upload')}</Button></footer>
    </form>
  </Dialog>;
}
