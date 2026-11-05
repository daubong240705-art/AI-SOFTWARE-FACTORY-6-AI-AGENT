import { z } from "zod";
import { idSchema, revisionSchema } from "./base.js";

export const appearanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: revisionSchema,
  theme: z.enum(["light", "dark", "system"]),
  locale: z.enum(["vi", "en"]),
});
export const windowLayoutSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision: revisionSchema,
    windows: z
      .array(
        z.strictObject({
          windowId: idSchema,
          projectId: idSchema,
          conversationId: idSchema,
          mode: z.enum(["open", "minimized", "closed"]),
          x: z.number().finite().min(-100_000).max(100_000),
          y: z.number().finite().min(-100_000).max(100_000),
          width: z.number().finite().min(1).max(100_000),
          height: z.number().finite().min(1).max(100_000),
          order: z.number().int().nonnegative().max(1000),
        }),
      )
      .max(10),
  })
  .refine(
    (layout) =>
      new Set(layout.windows.map((window) => window.windowId)).size ===
      layout.windows.length,
    "Duplicate window identity",
  )
  .refine(
    (layout) =>
      layout.windows.filter((window) => window.mode === "open").length <= 5,
    "At most five visible windows",
  );
// No message text, draft, credentials, run state or execution action in presentation preferences.
export type Appearance = z.infer<typeof appearanceSchema>;
export type WindowLayout = z.infer<typeof windowLayoutSchema>;
