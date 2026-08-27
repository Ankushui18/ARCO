const fs = require('fs');
const path = require('path');

const panels = fs.readFileSync(path.join(__dirname, 'src', 'ui-panels.js'), 'utf8');
const fig = fs.readFileSync(path.join(__dirname, 'src', 'figconv.js'), 'utf8');
const svg = fs.readFileSync(path.join(__dirname, 'src', 'svgexport.js'), 'utf8');
const pdf = fs.readFileSync(path.join(__dirname, 'src', 'pdfexport.js'), 'utf8');

for (const token of ['add-radial', 'data-image-mode', 'data-image-crop']) {
  if (!panels.includes(token)) throw new Error(`Fill inspector missing ${token}`);
}
if (!fig.includes("type: 'GRADIENT_RADIAL'")) throw new Error('.fig exporter drops radial gradients');
if (!fig.includes('out.fillGeometry')) throw new Error('.fig exporter drops primitive fill geometry');
if (!svg.includes('n.arrowStart && st')) throw new Error('SVG exporter drops start arrowheads');
if (!pdf.includes('if (n.arrowStart)')) throw new Error('PDF exporter drops start arrowheads');

console.log('PASS: fills, images, radial gradients and arrow exports are exposed');
