const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'src', 'arco-ui.js'), 'utf8');
for (const mode of ['design', 'prototype', 'inspect']) {
  if (!source.includes(`data-mode="${mode}"`)) throw new Error(`Top mode switch is missing ${mode}`);
}
if (!source.includes("['Help', helpItems]")) throw new Error('Primary menu bar is missing Help');
if (!source.includes("A.showShortcutsModal")) throw new Error('Help menu does not expose shortcuts');

console.log('PASS: Design, Prototype, Inspect and Help are discoverable');
