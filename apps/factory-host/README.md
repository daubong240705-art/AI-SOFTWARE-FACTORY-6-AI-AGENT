# Factory Host

The Host owns Factory state and workflow execution. It runs on Node.js, exposes a Fastify HTTP API, stores durable state in SQLite, and serves the built UI when available. See the [architecture](../../docs/architecture.md) and [setup guide](../../docs/setup/README.md).

Build `packages/factory-contracts` first, then run these commands from this directory:

```bash
npm run check
npm run build
npm test
npm run pack:check -- ../../packs/software-team
```

`src/main.ts` resolves configuration and starts `src/host.ts`; `src/cli/factory.ts` implements setup and diagnostics. From this directory, use `node dist/cli/factory.js doctor` or `node dist/main.js`. The default runtime is fake and the default listener is `127.0.0.1:8787`. Set `FACTORY_STATE_DIR` to an isolated local directory for development. Keep SQLite state on a filesystem that supports WAL. The Host applies migrations at startup.

See [`config/factory.env.example`](config/factory.env.example) for configuration. For gateway-backed features set `FACTORY_MODEL_BASE_URL` (for example `https://gateway.example/v1`), `FACTORY_MODEL_API_KEY` if required, and the approved models as needed. Set `NODE_EXTRA_CA_CERTS` only for a private CA. `factory doctor` checks setup; `factory doctor --model` makes a small model request.

Use fake adapters for local development and tests. OpenCode requires the Linux sandbox and Host model proxy. Local CLI adapters are opt-in and run with the operator's permissions; use them only with trusted workspaces.
