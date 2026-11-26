import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const patch = ['*** Begin Patch'];
for (const entry of input.trim().split(/^@@ /m).filter(Boolean)) {
  const [slug, ...lines] = entry.trimEnd().split('\n');
  const path = `apps/factory-site/docs/${process.argv[2]}/${slug}.md`;
  if (['faq', 'troubleshooting'].includes(slug)) {
    patch.push(`*** Add File: ${path}`);
  } else {
    const body = readFileSync(path, 'utf8').split(/^---\n/gm)[2].replace(/^\n|\n$/g, '');
    patch.push(`*** Update File: ${path}`, '@@', ...body.split('\n').map(line => `-${line}`));
  }
  patch.push(...lines.map(line => `+${line}`));
}
patch.push('*** End Patch', '');
process.exitCode = spawnSync('apply_patch', { input: patch.join('\n'), stdio: ['pipe', 'inherit', 'inherit'] }).status ?? 1;
