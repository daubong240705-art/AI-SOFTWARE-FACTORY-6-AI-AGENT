import { FileImage, FileJson, FileSpreadsheet, FileText, FileType2, Presentation } from 'lucide-react';
import { documentMedia } from '@/api/documents';
import { i18n } from '@/i18n';

export function documentType(mediaType: string): string {
  const type = mediaType.split(';')[0]?.toLowerCase();
  if (type === 'image/svg+xml') return 'svg';
  if (type?.startsWith('image/')) return 'image';
  return Object.entries(documentMedia).find(([, media]) => media === type)?.[0] ?? (type === 'text/x-diff' ? 'txt' : 'other');
}
export function DocumentIcon({ mediaType }: { mediaType: string }) {
  const type = documentType(mediaType);
  const Icon = type === 'xlsx' || type === 'csv' ? FileSpreadsheet : type === 'image' || type === 'svg' ? FileImage : type === 'json' ? FileJson : type === 'pptx' ? Presentation : type === 'txt' || type === 'md' ? FileType2 : FileText;
  return <Icon aria-hidden="true" className="size-5" />;
}
export function documentSize(bytes: number) {
  const unit = bytes >= 1024 * 1024 ? 'MB' : bytes >= 1024 ? 'KB' : 'B';
  return `${new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(bytes / (unit === 'MB' ? 1024 * 1024 : unit === 'KB' ? 1024 : 1))} ${unit}`;
}
