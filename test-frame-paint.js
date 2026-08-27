const fs = require('fs');
const vm = require('vm');
const path = require('path');

function context2d() {
  const calls = [];
  const ctx = {
    calls, globalAlpha: 1, globalAlphaBase: 1, fillStyle: '', strokeStyle: '',
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {},
    bezierCurveTo() {}, ellipse() {}, rect() {}, translate() {}, rotate() {}, scale() {},
    clip() { calls.push(['clip']); }, fill() { calls.push(['fill', this.fillStyle, this.shadowColor]); },
    stroke() { calls.push(['stroke']); }, setLineDash() {},
    fillRect(x, y, w, h) { calls.push(['fillRect', this.fillStyle, x, y, w, h]); },
    strokeRect() {}, drawImage() {}, createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return ctx;
}

const sandbox = {
  console, window: null, globalThis: null, Image: function () {}, Path2D: undefined,
  document: { createElement: () => ({ getContext: () => context2d() }) },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['src/model.js', 'src/render.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
}

const M = sandbox.Model;
const R = sandbox.Renderer;
const doc = M.newDoc('Frame paint');
const page = doc.pages[0];
const frame = M.makeNode('frame', { x: 10, y: 20, w: 320, h: 180 });
M.attach(doc, page, null, frame);

if (!frame.fills || frame.fills[0]?.color !== '#ffffff') {
  throw new Error('New frames must have the Figma-style white default fill');
}
if (frame.stroke.visible !== false) throw new Error('New frames must not have a visible stroke');

const transparent = M.makeNode('frame', { x: 0, y: 0, w: 100, h: 100 });
transparent.fills = [];
transparent.stroke.visible = false;
const transparentCtx = context2d();
R.drawNode(transparentCtx, page, transparent, doc);
if (transparentCtx.calls.some((c) => c[0] === 'fillRect')) {
  throw new Error('Transparent frames must not receive a forced plate or outline');
}

frame.fills[0].color = '#e4341e';
frame.radius = [24, 24, 24, 24];
frame.clips = false;
frame.shadows = [{ color: '#000000', opacity: .2, x: 0, y: 8, blur: 20, spread: 0, visible: true }];
const ctx = context2d();
R.drawNode(ctx, page, frame, doc);

const painted = ctx.calls.some((c) => c[0] === 'fillRect' && c[1] === 'rgba(228,52,30,1)');
const clippedBeforePaint = ctx.calls.findIndex((c) => c[0] === 'clip') < ctx.calls.findIndex((c) => c[0] === 'fillRect' && c[1] === 'rgba(228,52,30,1)');
if (!painted) throw new Error('Frame solid fill was not painted');
if (!clippedBeforePaint) throw new Error('Frame fill must respect its rounded path even when Clip content is off');

const ellipse = M.makeNode('ellipse', { x: 0, y: 0, w: 80, h: 80 });
ellipse.stroke = { color: '#22c55e', opacity: .6, width: 3, visible: true, align: 'inside' };
const ellipseCtx = context2d();
R.drawNode(ellipseCtx, page, ellipse, doc);
if (ellipseCtx.strokeStyle !== 'rgba(34,197,94,1)') {
  throw new Error('Ellipse stroke did not use its selected color');
}

const zeroLine = M.makeNode('line', { x: 0, y: 0, w: 120, h: 1 });
zeroLine.stroke.width = 0;
const zeroLineCtx = context2d();
R.drawNode(zeroLineCtx, page, zeroLine, doc);
if (zeroLineCtx.calls.some((c) => c[0] === 'stroke')) {
  throw new Error('A zero-width line must not be forced back to one pixel');
}

console.log('PASS: frame fill/radius/effects and shape stroke color rendering');
