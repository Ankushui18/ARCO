import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// index.html remains the readable source-of-truth for legacy module order.
// Production receives one deterministic application artifact, so a partial
// deploy or accidental script reorder cannot create a different runtime.
const scriptPattern = /<script\s+src="([^"]+)"\s*><\/script>/g;
const scripts = [...html.matchAll(scriptPattern)].map((match) => match[1]);
if (!scripts.length) throw new Error('No application scripts found in index.html');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });

let bundle = '/* Penfig Studio deterministic production bundle. */\n';
for (const relative of scripts) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Missing script: ${relative}`);
  bundle += `\n/* ---- ${relative} ---- */\n`;
  bundle += fs.readFileSync(absolute, 'utf8');
  bundle += '\n';
  if (relative === 'assets/figio.js') {
    bundle += 'window.FigIO = window.FigIOBundle && (window.FigIOBundle.default || window.FigIOBundle);\n';
  }
}
fs.writeFileSync(path.join(out, 'assets', 'penfig.js'), bundle);

const firstExternal = html.indexOf(`  <script src="${scripts[0]}"></script>`);
const lastTag = `<script src="${scripts[scripts.length - 1]}"></script>`;
const lastExternal = html.indexOf(lastTag, firstExternal);
if (firstExternal < 0 || lastExternal < 0) throw new Error('Could not replace source scripts');
const afterLast = lastExternal + lastTag.length;
let productionHtml = html.slice(0, firstExternal) +
  '  <script src="assets/penfig.js"></script>' +
  html.slice(afterLast);
// The assignment is emitted directly after figio inside the bundle.
productionHtml = productionHtml.replace(/\s*<script>window\.FigIO =[^<]+<\/script>/, '');
fs.writeFileSync(path.join(out, 'index.html'), productionHtml);

for (const file of ['app.css', 'manifest.webmanifest', 'sw.js', 'vercel.json']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
for (const file of ['ui3.css', 'inspector-ui3.css', 'arco-ds.css', 'interaction-ui.css', 'import-worker.js', 'export-worker.js']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(out, 'src', file));
}
fs.copyFileSync(path.join(root, 'assets', 'jszip.min.js'), path.join(out, 'assets', 'jszip.min.js'));

const swPath = path.join(out, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = '[^']+';/, "const CACHE = 'penfig-app-v21';");
sw = sw.replace("  './manifest.webmanifest',", "  './manifest.webmanifest',\n  './assets/penfig.js',\n  './src/ui3.css',\n  './src/inspector-ui3.css',\n  './src/arco-ds.css',\n  './src/interaction-ui.css',");
fs.writeFileSync(swPath, sw);

console.log(`Built ${scripts.length} ordered modules into dist/assets/penfig.js`);
