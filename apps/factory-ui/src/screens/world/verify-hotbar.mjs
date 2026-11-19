import './verify-loader.mjs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { WorldHotbar } = await import('./WorldHotbar.tsx');
const { toys, tools } = await import('./scene/toys/store.ts');
for(const walking of [false,true]) {
  toys.select(null);
  let html=renderToStaticMarkup(createElement(WorldHotbar,{walking,collapsed:false,onCollapse:()=>{}}));
  assert.equal((html.match(/aria-pressed=/g)??[]).length,9);
  assert.equal((html.match(/aria-pressed="true"/g)??[]).length,1);
  assert(html.includes('role="toolbar"'));
  for(let key=1;key<=9;key++) assert(html.includes(`<kbd>${key}</kbd>`));
  for(const tool of tools) {
    toys.select(tool);
    html=renderToStaticMarkup(createElement(WorldHotbar,{walking,collapsed:false,onCollapse:()=>{}}));
    assert.equal((html.match(/aria-pressed="true"/g)??[]).length,1);
    assert(html.includes(`${tools.indexOf(tool)+2}. worldUi.toys.${tool}`));
  }
  const collapsed=renderToStaticMarkup(createElement(WorldHotbar,{walking,collapsed:true,onCollapse:()=>{}}));
  assert(collapsed.includes('hidden="" role="toolbar"')); assert(collapsed.includes('aria-expanded="false"'));
}
const saved = new Map();
globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
const { setWorldPreferences, WORLD_PREFERENCES_KEY } = await import('./preferences.ts');
setWorldPreferences({hotbarCollapsed:true});
assert.equal(JSON.parse(saved.get(WORLD_PREFERENCES_KEY)).hotbarCollapsed,true);
setWorldPreferences({hotbarCollapsed:false});
assert.equal(JSON.parse(saved.get(WORLD_PREFERENCES_KEY)).hotbarCollapsed,false);
console.log('Hotbar SSR accessibility PASS (iso/Walk, 9 keys, exactly one pressed slot, collapse, persisted preference)');
