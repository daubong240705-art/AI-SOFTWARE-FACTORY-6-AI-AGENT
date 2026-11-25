# Factory Contracts

This package defines the shared Zod schemas and TypeScript types for Host commands, events, read models, entities, and Workflow v2 definitions. The `@factory/contracts/adapter` entry defines the boundary between the Host and agent runtimes. Host storage and UI presentation are not part of these contracts.

```bash
npm run check
npm run build
npm test
```

Build this package before checking or building either app. Both apps link to it from the repository and consume its `dist/` output. Review both consumers when changing a wire schema. Keep the legacy workflow schema and converter compatible with stored workflow imports.
