# Team pack template

Copy this directory to `packs/marketing-team` or another directory without a leading
underscore or dot. Those prefixes are reserved for templates and hidden directories;
the registry silently skips them. Change `key`, `name`, and the instructions for
your team. No Host code is required.

`pack.json` fields:

- `key`: unique lower-case pack identifier, 2–40 letters, digits or hyphens.
- `version`: semantic version. Bump it when publishing changes; existing teams keep
  their pinned snapshot, including profiles, skills, capabilities and tools.
- `name` and `description`: the team's public name and charter.
- `seats`: one Lead and up to fifteen workers. Each seat has a unique `name`, a
  descriptive `role`, a relative Markdown `profile`, a supported `runtime`, `slots`
  from 1 to 8, and `isLead`. Names connect pinned instructions to persisted seats.
- `seats[].capabilities`: optional unique capability identifiers (at most 12,
  lower-case letters, digits, dots and hyphens, at most 40 characters). Use
  domain names such as `marketing.research` and `marketing.copy`.
- `seats[].tools`: optional Host tool allowlist (at most 32 entries). Exact names
  and prefixes such as `knowledge.*` are accepted only if they match known Host
  tools. Omit for v1 access; `[]` removes every optional tool. Core tools
  `task.progress`, `output.register`, `decision.request`, `skill.get` remain allowed.
- `skills`: relative directories containing `SKILL.md` with `name`, `description`,
  `version`, and `source` frontmatter. Keep profiles short and put reusable steps
  in skills. Skill text is read from the team's pinned snapshot.
- `produces`: optional unique artifact kinds (at most 13), informational only.

Workers match every required task capability by equality or a dotted descendant:
`marketing.research.sources` satisfies `marketing.research`. Matching ignores case.
The least loaded worker wins, with name then id breaking ties. A task without
requirements can use any worker. Explicit owners take precedence. Teams without
worker capability declarations retain legacy selection.

From `apps/factory-host`, build and validate before creating the team:

```sh
npm run build
npm run pack:check -- ../../packs/marketing-team
npm run pack:check -- ../../packs/_template ../../packs/research-team
```

The validator reports metadata, errors and advisory warnings, without printing
file content or absolute paths. Exit codes: 0 all valid, 1 invalid pack, 2 usage.
The Host discovers the copied pack at startup; create a team from its key/version,
then engage it in a project. Declare task requirements using the same capabilities.
Allowlists can only remove optional Host tools; they cannot add tools or grant access
beyond the Host's existing permissions. External tools are outside this slice.
