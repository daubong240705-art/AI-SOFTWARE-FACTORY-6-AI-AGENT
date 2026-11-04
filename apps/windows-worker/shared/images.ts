import { z } from "zod";

export const imageLimits = {
  count: 4,
  inputBytes: 5 * 1024 * 1024,
  bytes: 1024 * 1024,
  edge: 4096,
  pixels: 12_000_000,
  projectBytes: 100 * 1024 * 1024,
  totalBytes: 500 * 1024 * 1024,
} as const;
export const imageScopeSchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
  })
  .strict();
export const imageImportSchema = imageScopeSchema
  .extend({
    name: z.string().min(1).max(180),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(imageLimits.inputBytes / 3) * 4),
  })
  .strict();
export const imageRefSchema = imageScopeSchema
  .extend({ id: z.string().uuid() })
  .strict();
export const imageIdsSchema = z
  .array(z.string().uuid())
  .max(imageLimits.count)
  .refine((ids) => new Set(ids).size === ids.length, "Ảnh đính kèm bị trùng.");
export type ChatImage = {
  id: string;
  projectId: string;
  conversationId: string;
  name: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  hash: string;
  createdAt: string;
  source: "user";
};
export const imageURL = (image: ChatImage) =>
  `asf-image://asset/${image.projectId}/${image.conversationId}/${image.id}`;
