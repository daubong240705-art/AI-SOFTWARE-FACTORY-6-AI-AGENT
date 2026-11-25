# Architecture Team

The Lead coordinates a System Architect, Data Model Designer, API Contract Designer, and Independent Architecture Reviewer. Skills cover planning, ADRs, API contracts, data modeling, review, handoffs, and structured verdicts.

Import and publish the desired flow in the project. Both take `brief` (confirmed Markdown) and optional `briefArtifactId` (a project artifact ID). The Lead starts only after explicit confirmation.

- `architecture-review`: current-state analysis, reviewed options and trade-offs, then an independently reviewed ADR and operator sign-off.
- `api-design`: a reviewed data model, matching API contract, and independent cross-check of invariants and compatibility before operator sign-off.

Each flow allows one draft revision. Sign-off covers the design only; neither flow implements it.
