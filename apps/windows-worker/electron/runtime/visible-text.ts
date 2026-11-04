import type { Event } from "@opencode-ai/sdk/v2/client";
// Only positively identified assistant text parts can reach the chat.
export class VisibleText {
  private assistants = new Set<string>();
  private parts = new Map<string, { messageId: string; text: string }>();
  consume(event: Event): string | undefined {
    if (event.type === "message.updated") {
      if (event.properties.info.role === "assistant")
        this.assistants.add(event.properties.info.id);
    } else if (event.type === "message.part.updated") {
      const part = event.properties.part;
      if (part.type !== "text" || part.synthetic || part.ignored) return;
      if (this.parts.size < 100 || this.parts.has(part.id))
        this.parts.set(part.id, {
          messageId: part.messageID,
          text: part.text.slice(0, 64000),
        });
    } else if (event.type === "message.part.delta") {
      const p = event.properties;
      const part = this.parts.get(p.partID);
      if (p.field !== "text" || !part || part.messageId !== p.messageID) return;
      part.text = (part.text + p.delta).slice(0, 64000);
    } else return;
    return [...this.parts.values()]
      .filter((p) => this.assistants.has(p.messageId))
      .map((p) => p.text)
      .join("\n\n")
      .slice(0, 64000);
  }
}
