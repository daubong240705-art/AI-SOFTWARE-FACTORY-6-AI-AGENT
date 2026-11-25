# Contributing to Factory

Factory is a local-first workspace for coordinating agents, workflows, and human review. Read the [architecture](docs/architecture.md) for system boundaries and the [setup guide](docs/setup/README.md) for installation.

## Build and test

Use Node.js 22.20 or newer and npm. There is no root npm workspace. Install dependencies with `npm ci` in each package on a new development machine. Build contracts first: both apps resolve `@factory/contracts` from its local `dist/`.

```bash
(cd packages/factory-contracts && npm run build && npm test)
(cd apps/factory-host && npm run check && npm run build && npm test)
(cd apps/factory-ui && npm run check && npm run build)
```

From the repository root, start the built Host locally with isolated state:

```bash
FACTORY_HOME="$HOME/.factory-dev" FACTORY_STATE_DIR="$HOME/.factory-dev/state" \
  FACTORY_RUNTIME=fake node apps/factory-host/dist/main.js
```

Open `http://127.0.0.1:8787` for the built UI, or run `npm run dev` in `apps/factory-ui` and open `http://127.0.0.1:5173`. Vite proxies the Host API; set `FACTORY_PORT` for both processes if changing the port. Keep bootstrap tokens local. Configure a real model or agent runtime only when needed.

## Layout and rules

- `apps/factory-host/`: TypeScript Host, SQLite migrations, CLI, and integration tests. Add migrations rather than rewriting previously applied ones.
- `apps/factory-ui/`: React/Vite UI, API client, SSE-driven state, and browser audit. Keep labels in English and Vietnamese catalogs.
- `packages/factory-contracts/`: shared schemas and the runtime adapter interface. Make boundary changes here before changing their consumers.
- `packs/`, `extensions/`: reusable library content; extensions are opt-in. `scripts/` contains setup and operations tools; `design/factory-v2/` holds shared UI tokens and labels.

Route writes through commands and preserve idempotency and revision checks. A model proposes; deterministic code validates and applies. Route durable external effects through the effect executor and reconcile uncertain outcomes before retrying. Keep unknown usage distinct from zero. Do not put credentials in fixtures, logs, browser state, agent prompts, or documentation. Use test doubles for network providers and explicit approval boundaries for real effects.
