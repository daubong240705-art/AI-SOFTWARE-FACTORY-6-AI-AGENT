import { z } from "zod";
import {
  idSchema,
  labelSchema,
  revisionSchema,
  sha256Schema,
  textSchema,
  timestampSchema,
} from "./base.js";
import { attemptIdentitySchema } from "./models.js";

/** A pinned reference: a Version, never "latest" (D-08). */
export const artifactRefSchema = z.strictObject({
  artifactId: idSchema,
  version: revisionSchema,
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactKindSchema = z.enum([
  "research-report",
  "requirements",
  "adr",
  "data-model",
  "api-contract",
  "ui-spec",
  "design-asset",
  "media",
  "code-ref",
  "dataset",
  "dossier",
  "plan",
  "other",
]);

/** Document status (02 §13). Attached to a Version, not to the Artifact. */
export const artifactStatusSchema = z.enum([
  "draft",
  "in-review",
  "reviewed",
  "approved",
  "superseded",
  "rejected",
  "withdrawn",
]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const ARTIFACT_TRANSITIONS: Readonly<
  Record<ArtifactStatus, readonly ArtifactStatus[]>
> = {
  draft: ["in-review", "withdrawn"],
  "in-review": ["reviewed", "rejected"],
  reviewed: ["approved", "rejected"],
  approved: ["superseded"],
  superseded: [],
  rejected: [],
  withdrawn: [],
};
export const canTransitionArtifact = (
  from: ArtifactStatus,
  to: ArtifactStatus,
): boolean => ARTIFACT_TRANSITIONS[from].includes(to);

/** May this status be an input that is REQUIRED for execution? Only approved (02 §13.2). */
export const isExecutionGrade = (status: ArtifactStatus): boolean =>
  status === "approved";

/**
 * Content fields are immutable once registered: only `status` (and the supersession link) change.
 * The Host stores the bytes by hash; `contentHash` is the identity of the content.
 */
export const artifactVersionSchema = z
  .strictObject({
    projectId: idSchema,
    artifactId: idSchema,
    version: revisionSchema,
    kind: artifactKindSchema,
    title: labelSchema,
    mediaType: z.string().min(1).max(128),
    contentHash: sha256Schema,
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    status: artifactStatusSchema,
    abstract: z.strictObject({
      l0: z.string().min(1).max(400),
      l1: textSchema.max(6_000).nullable(),
    }),
    producedBy: attemptIdentitySchema.nullable(), // null: uploaded by the operator
    inputs: z.array(artifactRefSchema).max(100),
    supersedes: artifactRefSchema.nullable(),
    visibility: z.enum(["team-draft", "project", "shared"]),
    createdAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.supersedes && value.supersedes.artifactId !== value.artifactId)
      ctx.addIssue({
        code: "custom",
        message: "A version supersedes an older version of the same artifact",
      });
    if (value.supersedes && value.supersedes.version >= value.version)
      ctx.addIssue({
        code: "custom",
        message: "Supersedes must reference an older version",
      });
    if (value.status === "approved" && value.visibility === "team-draft")
      ctx.addIssue({
        code: "custom",
        message: "An approved version cannot stay team-draft",
      });
  });
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

/** Dependants of a superseded version become stale; the Lead decides what to redo (02 §14.3). */
export function staleDependants(
  superseded: ArtifactRef,
  tasksInputs: ReadonlyArray<{ taskId: string; inputs: readonly ArtifactRef[] }>,
): string[] {
  return tasksInputs
    .filter((t) =>
      t.inputs.some(
        (i) =>
          i.artifactId === superseded.artifactId &&
          i.version === superseded.version,
      ),
    )
    .map((t) => t.taskId)
    .sort();
}
