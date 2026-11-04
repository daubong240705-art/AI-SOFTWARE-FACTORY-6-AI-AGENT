import type { WorkType, SkillId } from "./skills";

export const workTemplates: {
  id: string;
  label: string;
  workType: WorkType;
  skills: SkillId[];
  body: string;
  criteria: string[];
}[] = [
  {
    id: "feature",
    label: "Tính năng",
    workType: "implementation",
    skills: ["implement-feature", "testing"],
    body: "## Tính năng cần triển khai\n\n## Hành vi mong muốn\n\n## Phạm vi\n\nTriển khai trong phạm vi yêu cầu, tái sử dụng thành phần hiện có. Kiểm tra các thay đổi liên quan và báo cáo bằng chứng thực tế.",
    criteria: [
      "Hành vi mới đáp ứng yêu cầu đã mô tả",
      "Các kiểm tra liên quan có kết quả và bằng chứng",
    ],
  },
  {
    id: "bug",
    label: "Sửa lỗi",
    workType: "bugfix",
    skills: ["fix-bug", "testing"],
    body: "## Lỗi cần sửa\n\n## Cách tái hiện\n\n## Kết quả thực tế\n\n## Kết quả mong muốn\n\nTìm nguyên nhân trước khi sửa. Thay đổi phạm vi nhỏ và kiểm tra hồi quy liên quan.",
    criteria: [
      "Lỗi đã mô tả không còn tái hiện",
      "Có bằng chứng kiểm tra hồi quy liên quan",
    ],
  },
  {
    id: "review",
    label: "Review",
    workType: "analysis",
    skills: [],
    body: "## Phạm vi review\n\n## Điểm cần đánh giá\n\nChỉ đọc và đánh giá source, không sửa file. Ưu tiên lỗi có ảnh hưởng thực tế, nêu vị trí, tác động và cách khắc phục. Phân biệt điều đã xác minh với nhận định chưa kiểm chứng.",
    criteria: [
      "Mỗi phát hiện có vị trí và tác động cụ thể",
      "Không sửa source; nêu rõ giới hạn đánh giá",
    ],
  },
  {
    id: "docs",
    label: "Tài liệu",
    workType: "docs",
    skills: [],
    body: "## Tài liệu cần viết hoặc cập nhật\n\n## Người đọc\n\n## Phạm vi nội dung\n\nChỉ cập nhật tài liệu trong phạm vi yêu cầu. Đối chiếu hướng dẫn với source hiện tại; không thay đổi logic ứng dụng.",
    criteria: [
      "Nội dung khớp hành vi hiện có",
      "Ví dụ, đường dẫn và hướng dẫn được đối chiếu",
    ],
  },
];
export function applyWorkTemplate(id: string) {
  const template = workTemplates.find((t) => t.id === id);
  if (!template) throw new Error("Mẫu công việc không hợp lệ.");
  return { body: template.body, criteria: template.criteria.join("\n") };
}
