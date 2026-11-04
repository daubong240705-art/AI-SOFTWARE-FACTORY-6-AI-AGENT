import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Role } from "../../shared/contracts";
import type { Run } from "../../shared/runs";
import type { ProfileSnapshot, TeamTask } from "../../shared/team";
import {
  skillIds,
  type SkillId,
  type SkillSnapshot,
  type SkillCatalogSnapshot,
  type SkillSelection,
  type SkillTaskKind,
  type WorkType,
} from "../../shared/skills";
import { rolePolicy } from "./role-policy";

type Definition = Omit<SkillSnapshot, "version" | "hash" | "instructions">;
const definition = (
  id: SkillId,
  description: string,
  roles: Role[],
  taskKinds: SkillTaskKind[],
  requiredCapabilities: SkillSnapshot["requiredCapabilities"],
): Definition => ({
  id,
  description,
  roles,
  taskKinds,
  requiredCapabilities,
  path: `skills/${id}/SKILL.md`,
  source: "asf-internal",
});
const definitions: Definition[] = [
  definition(
    "implement-feature",
    "Thay đổi nhỏ đáp ứng acceptance, giữ scope và dependency hiện có.",
    ["be", "fe"],
    ["implementation"],
    ["read", "edit"],
  ),
  definition(
    "fix-bug",
    "Tái hiện, tìm nguyên nhân và sửa theo evidence; role chỉ đọc chỉ phân tích.",
    ["lead", "be", "fe", "test", "devops"],
    ["bugfix"],
    ["read"],
  ),
  definition(
    "testing",
    "Chọn kiểm tra phù hợp; kết luận bằng evidence, không ép test thừa.",
    ["lead", "be", "fe", "test", "devops"],
    ["implementation", "bugfix", "testing", "local-dev", "review"],
    ["read"],
  ),
  definition(
    "local-dev",
    "Toolchain local, không cấu hình hệ thống, SSH/deploy hoặc process nền.",
    ["devops"],
    ["local-dev", "bugfix"],
    ["read", "shell"],
  ),
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const versionOf = (text: string) =>
  text.match(/^version: (\d+\.\d+\.\d+)\r?$/m)?.[1];

// Fixed packaged paths only. No workspace/global discovery, URL, hook or model path.
export function loadSkillCatalog(
  root = resolve(__dirname, "../.."),
): SkillCatalogSnapshot {
  const skills = definitions.map((spec): SkillSnapshot => {
    const instructions = readFileSync(join(root, spec.path), "utf8");
    const version = versionOf(instructions);
    if (
      !version ||
      instructions.match(/^name: ([\w-]+)\r?$/m)?.[1] !== spec.id ||
      instructions.length > 12000
    )
      throw new Error(
        `Skill ${spec.id} thiếu name/version hợp lệ hoặc vượt giới hạn 12.000 ký tự.`,
      );
    return {
      ...structuredClone(spec),
      version,
      instructions,
      hash: hash(instructions),
    };
  });
  return { version: 1, skills };
}

export function validateSkillCatalog(catalog: SkillCatalogSnapshot): void {
  if (
    catalog.version !== 1 ||
    catalog.skills.length !== skillIds.length ||
    new Set(catalog.skills.map((s) => s.id)).size !== skillIds.length
  )
    throw new Error("Catalog skill snapshot thiếu hoặc không hợp lệ.");
  for (const skill of catalog.skills) {
    const spec = definitions.find((d) => d.id === skill.id);
    if (
      !spec ||
      Object.entries(spec).some(
        ([key, value]) =>
          JSON.stringify(skill[key as keyof SkillSnapshot]) !==
          JSON.stringify(value),
      ) ||
      skill.instructions.length > 12000 ||
      hash(skill.instructions) !== skill.hash ||
      versionOf(skill.instructions) !== skill.version ||
      skill.instructions.match(/^name: ([\w-]+)\r?$/m)?.[1] !== skill.id
    )
      throw new Error(`Skill snapshot ${skill.id} sai metadata/version/hash.`);
  }
}

export function inferWorkType(
  role: Role,
  text: string,
  allowedPaths: string[] = ["."],
): WorkType {
  if (role === "test") return "testing";
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase();
  const docScope =
    allowedPaths.length > 0 &&
    allowedPaths.every((p) =>
      /(^|\/)(docs?|readme)(\/|\.|$)|\.(md|mdx|rst|txt)$/i.test(
        p.replaceAll("\\", "/"),
      ),
    );
  if (
    docScope ||
    (/\b(docs?|documentation|readme|markdown|tai lieu|huong dan)\b/.test(
      normalized,
    ) &&
      !/\b(implement|implementation|code|api|component|logic|trien khai|tinh nang)\b/.test(
        normalized,
      ))
  )
    return "docs";
  if (
    /\b(bug(?:fix)?|debug|fix|repair|sua loi|khac phuc|loi)\b/.test(normalized)
  )
    return "bugfix";
  if (["lead", "pm", "ba"].includes(role)) return "analysis";
  if (
    /\b(review|analy[sz]e|explain|investigate|phan tich|danh gia|giai thich|khao sat)\b/.test(
      normalized,
    ) &&
    !/\b(implement|add|create|change|write|sua|trien khai)\b/.test(normalized)
  )
    return "analysis";
  if (role === "devops") return "local-dev";
  return "implementation";
}

function eligible(
  skill: SkillSnapshot,
  role: Role,
  kind: SkillTaskKind,
): boolean {
  const policy = rolePolicy(role);
  const capabilities = new Set([
    "read",
    ...(!policy.readOnly ? ["edit"] : []),
    ...(policy.allowShell ? ["shell"] : []),
  ]);
  return (
    skill.roles.includes(role) &&
    skill.taskKinds.includes(kind) &&
    skill.requiredCapabilities.every((c) => capabilities.has(c))
  );
}

export function selectSkills(
  catalog: SkillCatalogSnapshot,
  role: Role,
  taskKind: SkillTaskKind,
  suggested: readonly SkillId[] = [],
): SkillSelection {
  validateSkillCatalog(catalog);
  if (suggested.length > 3 || new Set(suggested).size !== suggested.length)
    throw new Error("Tối đa ba skill khác nhau cho một task.");
  for (const id of suggested) {
    const skill = catalog.skills.find((s) => s.id === id);
    if (!skill || !eligible(skill, role, taskKind))
      throw new Error(
        `Skill ${id} không phù hợp role/capability/loại task ${role}:${taskKind}.`,
      );
  }
  const defaults: Partial<Record<SkillTaskKind, SkillId[]>> = {
    implementation: ["implement-feature", "testing"],
    bugfix: ["fix-bug", "testing"],
    testing: ["testing"],
    "local-dev": ["local-dev", "testing"],
    review: ["testing"],
  };
  const ids = [
    ...new Set([
      ...(defaults[taskKind] ?? []).filter((id) =>
        eligible(catalog.skills.find((s) => s.id === id)!, role, taskKind),
      ),
      ...suggested,
    ]),
  ];
  if (ids.length > 3)
    throw new Error("Tổng skill mặc định và đề xuất vượt ba skill/task.");
  return {
    version: 1,
    role,
    taskKind,
    skills: ids.map((id) =>
      structuredClone(catalog.skills.find((s) => s.id === id)!),
    ),
  };
}

export function taskKind(
  task: Pick<
    TeamTask,
    "role" | "kind" | "instructions" | "title" | "allowedPaths" | "workType"
  >,
): SkillTaskKind {
  if (task.kind === "plan" || task.kind === "review") return task.kind;
  if (task.kind === "fix") return "bugfix";
  return (
    task.workType ??
    inferWorkType(
      task.role,
      `${task.title}\n${task.instructions}`,
      task.allowedPaths,
    )
  );
}

export function selectTaskSkills(
  run: Run,
  task: TeamTask,
): SkillSelection | undefined {
  if (!run.skillCatalog) {
    if (
      run.profiles.some((p) => p.skillMode === "task-v1") ||
      task.workType ||
      task.skillIds
    )
      throw new Error("Thiếu catalog skill snapshot cho task mới.");
    return; // Legacy history retains the combined profile it actually used.
  }
  return selectSkills(
    run.skillCatalog,
    task.role,
    taskKind(task),
    task.kind === "fix" ? [] : task.skillIds,
  );
}

export function selectedInstructions(
  run: Run,
  task: TeamTask | undefined,
  profile: ProfileSnapshot,
): string {
  const selected =
    task?.skillSelection ?? (task ? undefined : run.skillSelection);
  if (!run.skillCatalog) {
    if (profile.skillMode === "task-v1" || selected)
      throw new Error("Thiếu catalog skill snapshot.");
    return profile.instructions;
  }
  if (
    profile.skillMode !== "task-v1" ||
    profile.hash !== hash(profile.instructions)
  )
    throw new Error("Profile nền không khớp snapshot skill mới.");
  validateSkillCatalog(run.skillCatalog);
  const kind = task ? taskKind(task) : inferWorkType(run.role, run.prompt);
  if (
    !selected ||
    selected.version !== 1 ||
    selected.role !== profile.role ||
    selected.taskKind !== kind ||
    selected.skills.length > 3 ||
    new Set(selected.skills.map((s) => s.id)).size !== selected.skills.length
  )
    throw new Error("Thiếu hoặc sai skill selection snapshot.");
  for (const skill of selected.skills) {
    const saved = run.skillCatalog.skills.find((s) => s.id === skill.id);
    if (
      !saved ||
      JSON.stringify(skill) !== JSON.stringify(saved) ||
      !eligible(skill, profile.role, kind)
    )
      throw new Error(`Skill ${skill.id} không khớp snapshot hoặc quyền role.`);
  }
  const expected = selectSkills(
    run.skillCatalog,
    profile.role,
    kind,
    task?.kind === "fix" ? [] : task?.skillIds,
  );
  if (
    JSON.stringify(selected.skills.map((s) => s.id)) !==
    JSON.stringify(expected.skills.map((s) => s.id))
  )
    throw new Error("Danh sách skill không khớp lựa chọn của Controller.");
  return [
    profile.instructions,
    ...selected.skills.map((s) => s.instructions),
  ].join("\n\n");
}

export function skillCatalogSummary(catalog: SkillCatalogSnapshot | undefined) {
  return (
    catalog?.skills.map(
      ({ id, description, roles, taskKinds, requiredCapabilities }) => ({
        id,
        description,
        roles,
        taskKinds,
        requiredCapabilities,
      }),
    ) ?? []
  );
}
