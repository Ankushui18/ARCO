/* Security regression: public plugin execution must never fall back to the
 * editor realm when Worker isolation is unavailable. */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'src', 'plugins.js'), 'utf8');
const runStart = source.indexOf('run(code, App)');
const runEnd = source.indexOf('\n    // ---------------------------------------------------------------- local', runStart);
const runBody = source.slice(runStart, runEnd);
const localStart = source.indexOf('_runLocal(code, App)');
const localEnd = source.indexOf('\n    // --------------------------------------------------------------- worker', localStart);
const localBody = source.slice(localStart, localEnd);

if (runStart < 0 || /return\s+this\._runLocal/.test(runBody)) {
  throw new Error('Plugin sandbox contract broken: run() enables local fallback');
}
if (/new\s+Function/.test(localBody)) {
  throw new Error('Plugin sandbox contract broken: _runLocal evaluates source');
}

console.log('PASS: plugin execution requires an isolated worker');
