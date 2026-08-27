const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(dist, 'assets', 'penfig.js'), 'utf8');

if (!html.includes('assets/penfig.js')) throw new Error('Production HTML does not load the application bundle');
if ((html.match(/<script\s+src=/g) || []).length !== 1) throw new Error('Production HTML must load exactly one external runtime script');
for (const marker of ['src/model.js', 'src/render.js', 'src/ui-editor.js', 'src/main.js']) {
  if (!bundle.includes(`/* ---- ${marker} ---- */`)) throw new Error(`Bundle missing ${marker}`);
}
if (!bundle.includes('if (n.id === editingTextId) return;')) throw new Error('Bundle missing text-edit render guard');

console.log('PASS: deterministic production build is complete');
