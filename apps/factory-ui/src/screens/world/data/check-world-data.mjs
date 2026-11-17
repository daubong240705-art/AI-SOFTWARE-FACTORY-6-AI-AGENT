// Optional, compile-free check. Kept in data/ to respect this task's file ownership.
// Node 22.23+: node --experimental-strip-types src/screens/world/data/check-world-data.mjs
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) return nextResolve(pathToFileURL(resolve(root, 'src', specifier.slice(2)) + '.ts').href, context);
    // Production uses Vite's extensionless imports. Only this test process needs
    // a resolver; source modules and tsconfig stay unchanged.
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});
await import('./deriveWorld.test.ts');
