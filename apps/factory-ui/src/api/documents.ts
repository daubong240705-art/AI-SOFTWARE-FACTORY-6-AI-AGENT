export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
export const documentMedia = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
} as const;
export const documentAccept = Object.keys(documentMedia).map(extension => `.${extension}`).join(',');
export const mediaTypeForFile = (name: string): string | undefined => documentMedia[name.split('.').at(-1)?.toLowerCase() as keyof typeof documentMedia];
export function validateDocument(file: File): 'size' | 'type' | null {
  return file.size > MAX_UPLOAD_BYTES ? 'size' : !file.size || !mediaTypeForFile(file.name) ? 'type' : null;
}
