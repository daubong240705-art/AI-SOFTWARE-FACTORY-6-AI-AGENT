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
import { successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const envelope = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = envelope.omit({ ok: true, apiVersion: true });
const count = usageSchema.shape.inputTokens;
const statuses = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export const extractionSummarySchema = object.extend({
  status: textSchema.refine(value => statuses.includes(value as typeof statuses[number])).transform(value => value as typeof statuses[number]),
  pages: count.nullable(),
}).loose();
const extractionSchema = extractionSummarySchema.extend({
  chars: count.nullable(),
  outline: object.extend({ level: count.min(1).max(6), title: textSchema.min(0).max(200), page: count.positive().nullable(), offset: count }).loose().array().max(500),
  converter: textSchema.min(0), errorCode: textSchema.nullable(), updatedAt: textSchema,
});
export const extractionModels = {
  detail: envelope.extend({ extraction: extractionSchema }).loose(),
  text: envelope.extend({ text: textSchema.min(0).max(20000), from: count, next: count.nullable(), total: count }).loose(),
};
export type ExtractionSummary = Pick<ReturnType<typeof extractionSummarySchema.parse>, 'status' | 'pages'>;
export type Extraction = ReturnType<typeof extractionSchema.parse>;
export type ExtractionText = Pick<ReturnType<typeof extractionModels.text.parse>, 'text' | 'from' | 'next' | 'total'>;

