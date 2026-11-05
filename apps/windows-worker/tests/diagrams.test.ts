import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramSource, diagramLimits } from "../shared/diagrams";

test("Mermaid accepts bounded non-interactive flow, sequence, class, state and ER sources", () => {
  for (const source of [
    "flowchart LR\n A[Lead] --> B[Worker]",
    "graph TD; A-->B",
    "sequenceDiagram\n User->>Lead: Xin chào",
    "classDiagram\n class Project",
    "stateDiagram-v2\n [*] --> Ready",
    "erDiagram\n PROJECT ||--o{ TASK : contains",
  ])
    assert.equal(diagramSource(`\n${source}\n`), source);
});
test("Mermaid rejects directives, frontmatter, executable HTML, CSS, callbacks and external resources before rendering", () => {
  for (const source of [
    '%%{init:{"securityLevel":"loose"}}%%\nflowchart LR\nA-->B',
    'flowchart LR\n%%{init:{"securityLevel":"loose"}}%%\nA-->B',
    "---\nconfig:\n securityLevel: loose\n---\nflowchart LR\nA-->B",
    'flowchart LR\nA["<img src=x onerror=alert(1)>"]',
    'flowchart LR\nA["&lt;script&gt;"]',
    "flowchart LR\nclick A callback",
    'flowchart LR;click A "https://invalid.example"',
    "flowchart LR\nclassDef bad fill:url(https://invalid.example)",
    "flowchart LR\nstyle A fill:red",
    'flowchart LR\nA@{img:"https://invalid.example/a.png"}',
    'flowchart LR\nA["javascript:alert(1)"]',
    'flowchart LR\nA["file:///C:/secret"]',
    'flowchart LR\nA["data:image/svg+xml;base64,PHN2Zz4="]',
    'flowchart LR\nA["fa:fa-house"]',
    'flowchart LR\nA["`markdown`"]; B["$$math$$"]',
    'flowchart LR\nA["\\u003cscript"]',
    'flowchart LR\nA["\u0000"]',
  ])
    assert.throws(() => diagramSource(source), Error, source);
});
test("Mermaid rejects unsupported types and bounds input, lines, commands and edges", () => {
  for (const source of [
    "",
    "gantt\nsection X",
    "mindmap\nroot",
    "architecture-beta\ngroup x",
    "flowchart XX\nA-->B",
    "flowchart LR\n" + "A".repeat(diagramLimits.text),
    "flowchart LR\n" + "A\n".repeat(125),
    "flowchart LR\n" + "A;".repeat(190),
    "flowchart LR\n" +
      Array.from({ length: 81 }, (_, i) => `A${i}-->B${i}`).join(";"),
  ])
    assert.throws(() => diagramSource(source));
});
