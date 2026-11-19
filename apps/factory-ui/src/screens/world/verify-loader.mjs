// Shared offline loader for scene CPU checks. Production bundling is untouched.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/i18n') return { url: 'data:text/javascript,export const i18n={t:k=>k};export const useT=()=>i18n.t;', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of ['.ts', '.tsx', '/index.ts']) if (existsSync(fileURLToPath(base) + suffix)) return { url: base.href + suffix, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!/\.tsx?$/.test(url)) return next(url, context);
    let source = readFileSync(fileURLToPath(url), 'utf8');
    if (url.endsWith('/OriginalMascot.tsx')) source = source.slice(0, source.indexOf('const url =')).replace(/const urls = .*\n/, '');
    if (url.endsWith('/skins.ts')) source = source.match(/export function seatHash[^\n]+/)[0];
    return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
  },
});
