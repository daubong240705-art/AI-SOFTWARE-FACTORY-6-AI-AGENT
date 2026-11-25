# Software Team

The Lead coordinates BA requirements, PM planning, frontend and backend engineering, DevOps, and Test. Skills cover feature work, bug reproduction, local development, testing, handoffs, and structured verdicts.

Import and publish a flow in the project before asking the Lead to start it. Each flow takes `brief` (confirmed Markdown) and optional `briefArtifactId` (a project artifact ID). The Lead starts only after explicit confirmation.

- `software-delivery`: requirements and plan, peer-reviewed frontend/backend handoffs, then testing. A failed test allows at most three repair rounds. Only a passing candidate reaches operator sign-off and delivery output.
- `bug-fix`: a failing regression must reproduce the defect and identify its owning area. A peer reviews the fix; Test reruns the regression and related checks. At most two repair rounds precede operator sign-off.

Neither flow deploys. The legacy v1 `workflows/software-delivery.json` remains available to v1 consumers; the v2 flow takes precedence for the same key in the current importer.
