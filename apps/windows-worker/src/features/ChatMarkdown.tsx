import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { isValidElement, memo, useState } from "react";
import { MermaidBlock } from "./MermaidBlock";
import { ScrollRegion } from "../ui/primitives";
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="chat-code">
      <button
        aria-label="Sao chép đoạn code"
        onClick={async (event) => {
          const text =
            event.currentTarget.parentElement?.querySelector("pre")
              ?.textContent ?? "";
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
            setFailed(true);
          }
        }}
      >
        <Copy size={13} />
        {copied ? "Đã chép" : failed ? "Chép lại" : "Sao chép"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="chat-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <ScrollRegion
              label="Bảng trong phản hồi"
              className="markdown-table"
            >
              <table>{children}</table>
            </ScrollRegion>
          ),
          pre: ({ children }) => {
            if (
              isValidElement<{ className?: string; children?: unknown }>(
                children,
              ) &&
              children.props.className === "language-mermaid" &&
              typeof children.props.children === "string"
            ) {
              const source = children.props.children;
              return <MermaidBlock key={source} source={source} />;
            }
            return <CodeBlock>{children}</CodeBlock>;
          },
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void window.worker.openExternal(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span className="muted">{alt || "Hình ảnh"}</span>,
        }}
      >
        {text.slice(0, 100000)}
      </Markdown>
      {text.length > 100000 && (
        <p className="muted small">
          Nội dung dài đã được thu gọn. Xem báo cáo trong chi tiết lượt chạy.
        </p>
      )}
    </div>
  );
});
