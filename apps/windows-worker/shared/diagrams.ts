// The viewer supports a deliberately small, non-interactive Mermaid subset.
export const diagramLimits = {
  text: 8000,
  lines: 120,
  edges: 80,
  commands: 180,
  svgBytes: 600000,
  elements: 6000,
  edge: 8192,
  pixels: 16000000,
} as const;
export function diagramSource(input: string): string {
  const text = input.trim();
  if (
    !text ||
    text.length > diagramLimits.text ||
    text.split(/\r?\n/).length > diagramLimits.lines ||
    text.split(/[;\n]/).length > diagramLimits.commands
  )
    throw Error("Sơ đồ quá dài. Chia thành các sơ đồ nhỏ hơn.");
  if (
    !/^(?:flowchart\s+(?:TB|TD|BT|LR|RL)|graph\s+(?:TB|TD|BT|LR|RL)|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram)(?:\s|;|$)/.test(
      text,
    )
  )
    throw Error("Hỗ trợ flowchart, sequence, class, state và ER diagram.");
  // No frontmatter/directive overrides, HTML/markdown labels, URLs, custom CSS,
  // icon/image resources or link/callback commands before Mermaid touches DOM.
  if (
    /%%\{|---\s*\r?\n|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f`\\]|<\s*[!/?a-z]|&(?:#|[a-z]+;)|\$\$|(?:https?|file|data|javascript|vbscript):|www\.|(?:^|[\s;])(?:click|link|links|href|style|classDef|linkStyle|cssClass|accTitle|accDescr)\b|@\{|\b(?:img|image|icon|fa|fab|fas|logos):|url\s*\(|!\[/im.test(
      text,
    )
  )
    throw Error(
      "Sơ đồ chứa liên kết, tài nguyên hoặc cấu hình không được hỗ trợ.",
    );
  if (
    (text.match(/[-=.]+(?:>|\)|\|)|--|==|\.\./g) ?? []).length >
    diagramLimits.edges
  )
    throw Error("Sơ đồ có quá nhiều kết nối. Chia thành các sơ đồ nhỏ hơn.");
  return text;
}
