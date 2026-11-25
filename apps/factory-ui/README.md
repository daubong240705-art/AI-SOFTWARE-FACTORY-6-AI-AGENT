# Factory UI

The React/Vite UI is the operator's view of projects, Lead conversations, workflows, tasks, review, library, and runtime activity. It talks only to the Host API; command receipts, read models, and project events keep it in sync. See the [architecture](../../docs/architecture.md).

Build `packages/factory-contracts` first, then run from this directory:

```bash
npm run check
npm run build
npm run dev
```

The Host serves `dist/` in production. In development, Vite listens at `http://127.0.0.1:5173` and proxies `/api` to the Host (port `8787` by default; set `FACTORY_PORT` to match). Tokens are generated from `design/factory-v2/` before dev and build. Keep labels in both locale catalogs.

Use `npm run check:design` for design tokens, `npm run check:bundle` after building for the World bundle budget, and `npm run audit` for the Playwright browser audit. The audit uses a built Host and UI, a scratch state directory, and the fake runtime. It needs a local Chromium installation available to Playwright.
