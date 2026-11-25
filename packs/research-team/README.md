# Research Team

The Lead frames the decision; the Researcher finds and evaluates evidence, the Analyst compares options and drafts the report, and the Fact Checker reviews independently. Skills cover research briefs, source evaluation, comparisons, report writing, handoffs, and structured verdicts.

Import and publish `research-report` in the project. It takes `brief` (confirmed Markdown) and optionally `briefArtifactId` (a project artifact ID). The Lead waits for explicit confirmation before starting it.

The flow builds a reviewed source ledger, compares alternatives, and fact-checks the report. It allows one revision. A passing report goes to operator sign-off, then `artifact.save` stores the reviewed Markdown as a text artifact and the output links it. Nothing is published externally.
