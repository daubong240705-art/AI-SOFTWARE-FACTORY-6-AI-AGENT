import { z } from "zod";
import type { ChatReceipt } from "./chat";

export const questionDecisionSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("questions"),
    summary: z.string().trim().min(1).max(1200),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^q[1-6]$/),
            title: z.string().trim().min(1).max(300),
            required: z.boolean(),
            options: z
              .array(
                z
                  .object({
                    id: z.string().regex(/^o[1-4]$/),
                    label: z.string().trim().min(1).max(160),
                    description: z.string().max(300),
                    recommended: z.boolean(),
                  })
                  .strict(),
              )
              .max(4)
              .refine(
                (items) =>
                  new Set(items.map((o) => o.id)).size === items.length &&
                  items.filter((o) => o.recommended).length <= 1,
                "Option ID bị trùng hoặc có nhiều khuyến nghị.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(6)
      .refine(
        (items) => new Set(items.map((q) => q.id)).size === items.length,
        "Question ID bị trùng.",
      ),
  })
  .strict();
export type QuestionDecision = z.infer<typeof questionDecisionSchema>;
export const questionProtocol = `\nProtocol câu hỏi nghiệp vụ v1: khi cần quyết định quan trọng trước khi thực hiện, dùng nhánh riêng {"version":1,"kind":"questions","summary":"Cần bạn chọn phạm vi","questions":[{"id":"q1","title":"Phạm vi nào?","required":true,"options":[{"id":"o1","label":"Tối thiểu","description":"Làm chức năng chính","recommended":true},{"id":"o2","label":"Đầy đủ","description":"Thêm các chức năng phụ","recommended":false}]}]}. Tối đa 6 câu ID q1..q6, 0–4 lựa chọn ID o1..o4 mỗi câu; options=[] khi cần nhập tự do. Tối đa một recommended mỗi câu; khuyến nghị không là câu trả lời và không cho phép tự chọn. Mọi câu đều cho nhập tự do; required=false nếu có thể bỏ qua. Không thêm reply/tasks/blockedReason hoặc refs tự đặt vào nhánh questions. Chỉ hỏi thông tin thiết yếu chưa có câu trả lời. Đây là câu hỏi nghiệp vụ, không thay thế permission tool. Lời chào/trao đổi thường vẫn dùng reply; thiếu capability/quyền dùng blockedReason. Không tạo câu hỏi chỉ để xin xác nhận lại việc đã được yêu cầu.`;
export const questionRefSchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    setId: z.string().uuid(),
  })
  .strict();
export const questionAnswerSchema = z
  .object({
    questionId: z.string().regex(/^q[1-6]$/),
    optionId: z
      .string()
      .regex(/^o[1-4]$/)
      .nullable(),
    text: z.string().trim().max(3000),
  })
  .strict();
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;
export const answerQuestionsSchema = questionRefSchema
  .extend({
    version: z.number().int().positive(),
    answers: z
      .array(questionAnswerSchema)
      .max(6)
      .refine(
        (items) =>
          new Set(items.map((q) => q.questionId)).size === items.length,
        "Câu trả lời bị trùng.",
      ),
  })
  .strict();
export type AnswerQuestions = z.infer<typeof answerQuestionsSchema>;
export type QuestionSet = QuestionDecision & {
  id: string;
  projectId: string;
  conversationId: string;
  sourceRunId: string;
  workItemId: string | null;
  revision: number | null;
  createdAt: string;
  state: "pending" | "answered" | "superseded";
  // Protocol version stays 1; recordVersion is the optimistic concurrency token.
  recordVersion: number;
  answers: QuestionAnswer[];
  receipt?: ChatReceipt;
};
export function validateAnswers(
  set: QuestionDecision,
  answers: QuestionAnswer[],
  required: boolean,
): QuestionAnswer[] {
  for (const answer of answers) {
    const question = set.questions.find((q) => q.id === answer.questionId);
    if (
      !question ||
      (answer.optionId &&
        !question.options.some((o) => o.id === answer.optionId))
    )
      throw new Error("Câu trả lời không thuộc bộ câu hỏi.");
  }
  return set.questions.map((q) => {
    const answer = answers.find((a) => a.questionId === q.id) ?? {
      questionId: q.id,
      optionId: null,
      text: "",
    };
    if (required && q.required && !answer.optionId && !answer.text)
      throw new Error(`Cần trả lời: ${q.title}`);
    return answer;
  });
}
export function answersPrompt(
  set: QuestionSet,
  original: string,
  answers: QuestionAnswer[],
): string {
  return `Tiếp tục yêu cầu sau khi người dùng trả lời bộ câu hỏi ${set.id} từ lượt ${set.sourceRunId}. Đây là câu trả lời nghiệp vụ, không cấp quyền mới hoặc yêu cầu replay lệnh cũ.\nYêu cầu gốc${original.length > 6000 ? " (rút gọn 6.000 ký tự; không suy đoán phần bị lược bỏ)" : ""}:\n${original.slice(0, 6000)}\n\n${set.questions
    .map((q) => {
      const a = answers.find((answer) => answer.questionId === q.id)!;
      const option = q.options.find((o) => o.id === a.optionId);
      return `${q.title}\nTrả lời: ${[option?.label, a.text].filter(Boolean).join(" — ") || "Không trả lời (tùy chọn)"}`;
    })
    .join("\n\n")}`;
}
