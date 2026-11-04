import { useState } from "react";
import type { FollowUp } from "../../shared/chat";
export function FollowUpCard({
  item,
  busy,
  active,
  first,
  onEdit,
  onRemove,
  onResume,
}: {
  item: FollowUp;
  busy: boolean;
  active: boolean;
  first: boolean;
  onEdit: (prompt: string) => Promise<void>;
  onRemove: () => void;
  onResume: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.prompt);
  return (
    <div className="follow-up-card">
      <div className="inline">
        <strong>{item.state === "held" ? "Đang giữ" : "Hàng chờ"}</strong>
        <span
          className="muted small"
          title={item.settings.agents.find((a) => a.role === item.role)?.model}
        >
          {item.mode === "team" ? "Đội agent" : item.role.toUpperCase()}
        </span>
      </div>
      {editing ? (
        <textarea
          aria-label="Sửa yêu cầu chờ"
          value={text}
          maxLength={32000}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <p>{item.prompt}</p>
      )}
      {item.reason && <span className="muted small">{item.reason}</span>}
      <div className="inline">
        {editing ? (
          <>
            <button
              disabled={busy || !text.trim()}
              onClick={() =>
                void onEdit(text.trim())
                  .then(() => setEditing(false))
                  .catch(() => {})
              }
            >
              Lưu
            </button>
            <button onClick={() => setEditing(false)}>Hủy</button>
          </>
        ) : (
          <button
            disabled={busy || !!item.boardItemId}
            title={
              item.boardItemId
                ? "Bỏ khỏi hàng chờ rồi sửa thẻ trong Công việc"
                : undefined
            }
            onClick={() => {
              setText(item.prompt);
              setEditing(true);
            }}
          >
            Sửa
          </button>
        )}
        <button disabled={busy} onClick={onRemove}>
          Xóa
        </button>
        {first && !active && (
          <button disabled={busy || editing} onClick={onResume}>
            Chạy tiếp
          </button>
        )}
      </div>
    </div>
  );
}
