import assert from 'node:assert/strict';
import { buildTree, pathDisplay, slugify, subtreeIds } from './tree.ts';

const groups = [
  { id: 'child', parentId: 'parent', path: 'doi/web' },
  { id: 'parent', parentId: null, path: 'doi' },
  { id: 'grandchild', parentId: 'child', path: 'doi/web/app' },
  { id: 'other', parentId: null, path: 'other' },
];
const grouped = { id: 'grouped' };
const root = { id: 'root' };
const missing = { id: 'missing' };
const tree = buildTree(groups, [grouped, root, missing], { grouped: 'child', missing: 'unknown' });
assert.deepEqual(tree.groups.map(branch => branch.group.id), ['parent', 'other']);
assert.deepEqual(tree.groups[0].groups[0].projects, [grouped]);
assert.deepEqual(tree.projects, [root, missing]);
assert.deepEqual(subtreeIds(groups, 'parent'), new Set(['parent', 'child', 'grandchild']));
assert.equal(pathDisplay(groups, 'grandchild', 'root'), 'doi/web/app');
assert.equal(pathDisplay(groups, null, 'root'), 'root');
assert.equal(slugify('\u0110\u1ed9i K\u1ef9 thu\u1eadt!'), 'doi-ky-thuat');
assert.equal(slugify('...'), '');
assert.equal(slugify(`${'a'.repeat(49)} b`), 'a'.repeat(49));
console.log('Group tree self-check passed.');
