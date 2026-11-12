import { seatSchema, successResponseSchema, textSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true, apiVersion: true });
const flag = seatSchema.shape.isLead;
const path = textSchema.min(1).refine(value => value.startsWith('/'));
const entry = object.omit({ ok: true, apiVersion: true }).extend({
  name: textSchema.min(1).refine(value => !value.includes('/') && value !== '.' && value !== '..'),
  isGit: flag.catch(false),
}).strip();

// Ignore future fields and skip malformed optional entries without losing a usable listing.
export const folderBrowseModel = object.extend({
  path,
  parent: path.nullable().optional().catch(null).transform(value => value ?? null),
  roots: path.array().catch([]),
  entries: entry.nullable().catch(null).array().catch([]).transform(items => items.filter(item => item !== null)),
  truncated: flag.catch(false),
}).strip();

export type FolderListing = ReturnType<typeof folderBrowseModel.parse>;
