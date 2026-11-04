import { useEffect, useRef, useState } from "react";
import type { QuestionAnswer, QuestionSet } from "../../shared/questions";
import type { Reply } from "../../shared/contracts";
async function unwrap<T>(promise: Promise<Reply<T>>) {
  const reply = await promise;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
export function QuestionCards({
  set,
  onChanged,
  beforeSubmit,
  registerFlush,
}: {
  set: QuestionSet;
  onChanged: () => void;
  beforeSubmit: () => Promise<unknown>;
  registerFlush: (id: string, flush: (() => Promise<unknown>) | null) => void;
}) {
  const [answers, setAnswers] = useState<QuestionAnswer[]>(set.answers);
  const answersRef = useRef(answers),
    version = useRef(set.recordVersion);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve()),
    lock = useRef(false);
  const [result, setResult] = useState<QuestionSet | null>(null);
  const current =
    result && result.recordVersion >= set.recordVersion ? result : set;
  const disabled = current.state !== "pending" || busy;
  const currentState = useRef(current.state);
  currentState.current = current.state;
  const ref = {
    projectId: set.projectId,
    conversationId: set.conversationId,
    setId: set.id,
  };
  useEffect(() => {
    registerFlush(set.id, () =>
      currentState.current === "pending" ? writes.current : Promise.resolve(),
    );
    return () => registerFlush(set.id, null);
  }, [set.id, registerFlush]);
  useEffect(() => {
    if (set.state === "answered" && set.receipt) setError("");
  }, [set.state, set.receipt?.runId, set.receipt?.followUpId]);
  function change(questionId: string, patch: Partial<QuestionAnswer>) {
    const existing = answersRef.current.find(
      (a) => a.questionId === questionId,
    ) ?? { questionId, optionId: null, text: "" };
    const next = [
      ...answersRef.current.filter((a) => a.questionId !== questionId),
      { ...existing, ...patch },
    ];
    answersRef.current = next;
    setAnswers(next);
    setSaving(true);
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        const saved = await unwrap(
          window.worker.saveQuestionDraft({
            ...ref,
            version: version.current,
            answers: next,
          }),
        );
        version.current = saved.recordVersion;
        setError("");
      });
    const pending = writes.current;
    void pending
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Chưa lưu được câu trả lời."),
      )
      .finally(() => {
        if (writes.current === pending) setSaving(false);
      });
  }
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await writes.current;
      await beforeSubmit();
      const saved = await unwrap(
        window.worker.answerQuestions({
          ...ref,
          version: version.current,
          answers: answersRef.current,
        }),
      );
      version.current = saved.recordVersion;
      setResult(saved);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa gửi được câu trả lời.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const closed = current.state !== "pending";
  return (
    <section
      className={`question-set ${current.state}`}
      aria-label="Câu hỏi từ Lead"
      data-question-set={set.id}
    >
      <header>
        <strong>{set.summary}</strong>
        {set.revision !== null && (
          <span className="muted small">Yêu cầu v{set.revision}</span>
        )}
        <span className="muted small">
          {current.state === "pending"
            ? "Cần bạn trả lời"
            : current.state === "superseded"
              ? "Đã thay thế"
              : "Đã lưu câu trả lời"}
        </span>
      </header>
      {current.state === "superseded" && (
        <p className="muted small">
          Yêu cầu hoặc hội thoại đã thay đổi. Bộ câu hỏi này chỉ để tham khảo.
        </p>
      )}
      {closed ? (
        <details>
          <summary>Xem câu hỏi và câu trả lời</summary>
          {set.questions.map((q) => {
            const answer = current.answers.find((a) => a.questionId === q.id),
              option = q.options.find((o) => o.id === answer?.optionId);
            return (
              <div className="question-history" key={q.id}>
                <strong>{q.title}</strong>
                <p>
                  {[option?.label, answer?.text].filter(Boolean).join(" — ") ||
                    "Chưa trả lời"}
                </p>
              </div>
            );
          })}
        </details>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {set.questions.map((q) => {
            const answer = answers.find((a) => a.questionId === q.id);
            return (
              <fieldset key={q.id} disabled={disabled}>
                <legend>
                  {q.title}{" "}
                  <span className="muted small">
                    {q.required ? "Bắt buộc" : "Tùy chọn"}
                  </span>
                </legend>
                {!!q.options.length && (
                  <div className="question-options">
                    {q.options.map((option) => (
                      <label
                        className={
                          answer?.optionId === option.id ? "selected" : ""
                        }
                        key={option.id}
                      >
                        <input
                          type="radio"
                          name={`${set.id}-${q.id}`}
                          value={option.id}
                          checked={answer?.optionId === option.id}
                          onChange={() => change(q.id, { optionId: option.id })}
                        />
                        <span>
                          <strong>
                            {option.label}
                            {option.recommended && <small>Đề xuất</small>}
                          </strong>
                          {option.description && (
                            <span>{option.description}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {answer?.optionId && (
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => change(q.id, { optionId: null })}
                  >
                    Bỏ lựa chọn
                  </button>
                )}
                <textarea
                  aria-label={`Trả lời: ${q.title}`}
                  rows={2}
                  maxLength={3000}
                  value={answer?.text ?? ""}
                  placeholder={
                    q.options.length
                      ? "Hoặc nhập câu trả lời / bổ sung…"
                      : "Nhập câu trả lời…"
                  }
                  onChange={(e) => change(q.id, { text: e.target.value })}
                />
              </fieldset>
            );
          })}
          <div className="question-actions">
            <span className="muted small" role="status">
              {saving
                ? "Đang lưu nháp…"
                : error
                  ? "Chưa gửi câu trả lời"
                  : "Nháp được lưu trên máy"}
            </span>
            <button className="primary" disabled={disabled || saving}>
              Gửi câu trả lời
            </button>
          </div>
        </form>
      )}
      {current.receipt && (
        <p className="muted small">
          {current.receipt.state === "removed"
            ? "Yêu cầu tiếp nối đã bỏ khỏi hàng chờ."
            : current.receipt.followUpId
              ? "Yêu cầu tiếp nối đã lưu trong hàng chờ."
              : "Đã tạo lượt tiếp nối."}
        </p>
      )}
      {error && (
        <div className="chat-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            disabled={busy || saving}
            onClick={async () => {
              try {
                const latest = await unwrap(window.worker.questionSet(ref));
                version.current = latest.recordVersion;
                setResult(latest);
                writes.current = Promise.resolve();
                setError("");
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Chưa tải được câu hỏi.",
                );
              }
            }}
          >
            Tải lại phiên bản
          </button>
        </div>
      )}
    </section>
  );
}
