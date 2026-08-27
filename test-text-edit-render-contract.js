/* Regression contract: inline text has exactly one pixel owner.
 *
 * The renderer must skip the active text node before it delegates to the
 * optional rich TextEngine.  If the order is reversed, the canvas paints a
 * second copy underneath the DOM editor.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'src', 'render.js'), 'utf8');
const start = source.indexOf('function drawText(');
const end = source.indexOf('\n  // Layout grid', start);
const body = source.slice(start, end > start ? end : start + 1800);

const guard = body.indexOf('if (n.id === editingTextId) return;');
const delegate = body.indexOf('global.TextEngine && global.TextEngine.draw');

if (start < 0 || guard < 0 || delegate < 0 || guard > delegate) {
  throw new Error('Text edit render contract broken: edit guard must precede TextEngine delegation');
}

console.log('PASS: editing text is skipped before rich-text delegation');
