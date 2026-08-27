/* plugins.js — Figma-style plugin system (sandboxed plugins).
 *
 * Headless plugins run against a small, explicit, ASYNC API surface
 * (`penfig`). In a real browser the code executes in a dedicated Web
 * Worker — a separate JS realm that cannot reach the host's window,
 * document, or localStorage. The worker talks to the app only through a
 * whitelisted postMessage RPC (see handleRpc); any call not on the list
 * is rejected. The plugin API is the RPC contract: everything takes
 * plain data in, plain data out (nodes are summaries; writes go through
 * setProps/setPos/create/remove), so behavior is identical whether the
 * call crosses the worker boundary or not.
 *
 * Where Web Workers are unavailable (headless test environments, some
 * webviews) execution falls back to `new Function` in the local realm —
 * a trusted-local channel, clearly labeled as such in the UI.
 *
 * Plugin code is wrapped in an async IIFE: top-level `await` and
 * top-level `return <result>` both work.
 *
 * UI plugins (the Open button) additionally get a sandboxed iframe(srcdoc)
 * panel bridged over the same whitelisted RPC.
 */
(function (global) {
  'use strict';
  const M = global.Model;

  const Plugins = {
    builtins: [
      {
        id: 'arrange', name: 'Arrange selection in a grid',
        desc: 'Lays selected nodes out in an equal grid with 24px gaps.',
        code: `
const sel = (await penfig.selection()).ids;
if (!sel.length) return 'Select at least one node first.';
await penfig.history.begin();
const cols = Math.ceil(Math.sqrt(sel.length));
const gap = 24, size = 120;
for (let i = 0; i < sel.length; i++) {
  const row = Math.floor(i / cols), col = i % cols;
  await penfig.setPos(sel[i], col * (size + gap), row * (size + gap));
}
await penfig.history.end();
await penfig.refresh();
return 'Arranged ' + sel.length + ' node(s) in ' + cols + '-column grid.';
`,
      },
      {
        id: 'rename', name: 'Number selection (01 · name)',
        desc: 'Prefixes selected layer names with zero-padded indexes.',
        code: `
const sel = (await penfig.selection()).ids;
if (!sel.length) return 'Nothing selected.';
await penfig.history.begin();
let i = 0;
for (const id of sel) {
  const n = await penfig.getNode(id);
  if (n && !/^\\d+ · /.test(n.name)) { i++; await penfig.setProps(id, { name: String(i).padStart(2, '0') + ' · ' + n.name }); }
}
await penfig.history.end();
await penfig.refresh();
return 'Renamed ' + sel.length + ' node(s).';
`,
      },
      {
        id: 'mode', name: 'Cycle token mode',
        desc: 'Moves the design to the next variable mode (Light → Dark → …).',
        code: `
const doc = await penfig.doc();
const modes = doc.modes;
const i = modes.findIndex(m => m.id === doc.defaultMode);
await penfig.history.begin();
const next = modes[(i + 1) % modes.length];
await penfig.setMode(next.id);
await penfig.history.end();
await penfig.refresh();
return 'Mode → ' + next.name;
`,
      },
      {
        id: 'outline', name: 'Outline all text',
        desc: 'Gives every text node in the page a visible 1px stroke.',
        code: `
const nodes = await penfig.listNodes();
await penfig.history.begin();
let n = 0;
for (const s of nodes) {
  if (s.type === 'text') { await penfig.setProps(s.id, { stroke: { color: '#000000', width: 1, opacity: 0.3, align: 'outside', token: null, visible: true } }); n++; }
}
await penfig.history.end();
await penfig.refresh();
return 'Outlined ' + n + ' text node(s).';
`,
      },
      {
        id: 'modes', name: 'Theme switcher (UI plugin)',
        desc: 'A plugin with a live UI panel — lists token modes, switches on click, toasts the result.',
        code: '',
        ui: `
const doc = await penfig.call('doc');
const box = document.createElement('div');
box.style.cssText = 'font:13px/1.6 system-ui,sans-serif';
box.innerHTML =
  '<div style="font-weight:600;margin-bottom:6px">Mode: <b id="pf-cur"></b></div><div id="pf-modes"></div>';
document.body.appendChild(box);
const cur = box.querySelector('#pf-cur');
const modes = box.querySelector('#pf-modes');
const paint = (d) => {
  cur.textContent = (d.modes.find(m => m.id === d.defaultMode) || {}).name || d.defaultMode;
  modes.innerHTML = d.modes.map(m =>
    '<button data-m="' + m.id + '" style="margin:0 6px 6px 0;padding:3px 12px;border-radius:6px;border:1px solid #555;background:' +
    (m.id === d.defaultMode ? '#4a9eff' : '#2a2a31') + ';color:#fff;cursor:pointer">' + m.name + '</button>').join('');
};
paint(doc);
modes.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  await penfig.call('setMode', b.getAttribute('data-m'));
  paint(await penfig.call('doc'));
  penfig.toast('Mode switched');
});
`,
      },
    ],

    custom: {
      all() { try { return JSON.parse(localStorage.getItem('penfig.plugins.v1')) || []; } catch (e) { return []; } },
      save(list) { try { localStorage.setItem('penfig.plugins.v1', JSON.stringify(list)); } catch (e) { } },
      add(p) { const l = this.all(); p.id = M.uid('pl-'); l.push(p); this.save(l); return p; },
      remove(id) { this.save(this.all().filter(p => p.id !== id)); },
    },

    // internal live-API helpers (host realm only — never exposed to plugins)
    api(App) {
      return {
        doc: {
          get name() { return App.doc.name; },
          set name(v) { App.doc.name = v; },
          get vars() { return App.doc.vars; },
        },
        get page() { return App.page; },
        get selection() { return { ids: App.sel.slice() }; },
        setSelection: (ids) => App.setSel(ids || []),
        getNode: (id) => App.page.nodes[id] || null,
        setPos: (id, x, y) => { const n = App.page.nodes[id]; if (n) { n.x = x; n.y = y; } },
        setProps: (id, props) => { const n = App.page.nodes[id]; if (!n) return; for (const k of Object.keys(props || {})) n[k] = props[k]; },
        create: (type, props) => { const n = M.makeNode(type, props || {}); M.attach(App.doc, App.page, null, n); App.sel = [n.id]; return n; },
        remove: (id) => { const n = App.page.nodes[id]; if (n) M.detach(App.page, n); },
        history: { begin: () => App.history.begin(App.doc), end: () => App.history.end(App.doc) },
        refresh: () => App.markDirty(),
        toast: (msg) => App.toast(String(msg)),
      };
    },

    // ------------------------------------------------------------- RPC surface
    // The whitelisted plugin API. Every plugin (worker headless, local
    // fallback, and UI-panel) talks through these names — anything else is
    // rejected, so a plugin can never touch the host DOM or go past the
    // explicit surface. Data in, data out: nodes arrive as plain summaries
    // and mutations go through setProps/setPos/create/remove.
    handleRpc(App, name, args) {
      const A = this.api(App);
      switch (name) {
        case 'doc':
          return { name: App.doc.name, defaultMode: App.doc.vars.defaultMode, modes: (App.doc.vars.modes || []).map(m => ({ id: m.id, name: m.name })) };
        case 'setMode':
          if (!(App.doc.vars.modes || []).some(m => m.id === args[0])) throw new Error('unknown mode ' + args[0]);
          App.doc.vars.defaultMode = args[0];
          App.markDirty();
          return true;
        case 'selection': return { ids: App.sel.slice() };
        case 'setSelection': A.setSelection(args[0]); App.markDirty(); return true;
        case 'listNodes': {
          const list = [];
          for (const id of Object.keys(App.page.nodes)) {
            const n = App.page.nodes[id];
            list.push({ id: n.id, name: n.name, type: n.type, x: n.x, y: n.y, w: n.w, h: n.h, visible: n.visible });
          }
          return list;
        }
        case 'getNode': {
          const n = A.getNode(args[0]);
          if (!n) return null;
          return { id: n.id, name: n.name, type: n.type, x: n.x, y: n.y, w: n.w, h: n.h, visible: n.visible };
        }
        case 'setPos': A.setPos(args[0], args[1], args[2]); App.markDirty(); return true;
        case 'setProps': A.setProps(args[0], args[1]); App.markDirty(); return true;
        case 'create': { const n = A.create(args[0], args[1]); App.markDirty(); return n && n.id; }
        case 'remove': A.remove(args[0]); App.markDirty(); return true;
        case 'historyBegin': App.history.begin(App.doc); return true;
        case 'historyEnd': App.history.end(App.doc); return true;
        case 'refresh': App.markDirty(); return true;
        case 'toast': App.toast(String(args[0])); return true;
        default: throw new Error('blocked plugin call: ' + name);
      }
    },

    // build a penfig proxy over a call(name, ...args) function —
    // identical shape in worker mode (calls become Promises) and local
    // mode (calls resolve synchronously), so plugin code can just `await`.
    _penfigProxy(call) {
      return {
        doc: () => call('doc'),
        setMode: (id) => call('setMode', id),
        selection: () => call('selection'),
        setSelection: (ids) => call('setSelection', ids),
        listNodes: () => call('listNodes'),
        getNode: (id) => call('getNode', id),
        setPos: (id, x, y) => call('setPos', id, x, y),
        setProps: (id, p) => call('setProps', id, p),
        create: (type, props) => call('create', type, props),
        remove: (id) => call('remove', id),
        history: { begin: () => call('historyBegin'), end: () => call('historyEnd') },
        refresh: () => call('refresh'),
        toast: (msg) => call('toast', msg),
      };
    },

    _consoleStub(logs) {
      const line = (...a) => logs.push(a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
      return { log: line, warn: line, error: line };
    },

    workerAvailable() {
      return typeof Worker === 'function' && typeof Blob === 'function' &&
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    },

    // run headless plugin code. Returns a Promise of
    // { ok, result?, error?, logs, sandbox: 'worker' | 'local' }.
    run(code, App) {
      if (this.workerAvailable()) return this._runWorker(code, App);
      // Never execute plugin source in the editor's own realm.  Doing so gives
      // the plugin access to window, document, storage and every editor global.
      // A missing Worker is therefore an unsupported environment, not a reason
      // to silently weaken the security boundary.
      return Promise.resolve({
        ok: false,
        error: 'Plugins require Web Worker support in this browser.',
        logs: [],
        sandbox: 'unavailable',
      });
    },

    // ---------------------------------------------------------------- local
    // Kept only for backwards-compatible internal callers. Public plugin
    // execution never reaches this method; run() requires a Worker sandbox.
    _runLocal(code, App) {
      return Promise.resolve({
        ok: false,
        error: 'Unsafe local plugin execution is disabled.',
        logs: [],
        sandbox: 'unavailable',
      });
    },

    // --------------------------------------------------------------- worker
    // Hard sandbox: the plugin code runs in a Web Worker (separate realm).
    // It only gets the penfig RPC proxy + a console stub; no host window,
    // document, or localStorage. All state changes come back over the
    // whitelisted postMessage RPC. 15s timeout, then the worker is killed.
    _runWorker(code, App) {
      return new Promise((resolve) => {
        const logs = [];
        let settled = false, worker = null, url = null, timer = null;
        const finish = (r) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try { if (worker) worker.terminate(); } catch (e) { }
          try { if (url) URL.revokeObjectURL(url); } catch (e) { }
          resolve(r);
        };
        try {
          url = URL.createObjectURL(new Blob([this._workerBootstrap()], { type: 'text/javascript' }));
          worker = new Worker(url);
        } catch (e) {
          if (url) { try { URL.revokeObjectURL(url); } catch (e2) { } }
          return finish({ ok: false, error: 'could not start plugin worker: ' + String(e && e.message || e), logs, sandbox: 'worker' });
        }
        timer = setTimeout(() => finish({ ok: false, error: 'plugin timed out (15s limit)', logs, sandbox: 'worker' }), 15000);
        worker.onmessage = (e) => {
          const m = e.data;
          if (!m || typeof m !== 'object') return;
          if (m.t === 'call') {
            let result, error;
            try { result = this.handleRpc(App, m.name, m.args || []); }
            catch (err) { error = String(err && err.message || err); }
            try { worker.postMessage({ t: 'res', seq: m.seq, result, error }); } catch (e2) { }
          } else if (m.t === 'log') {
            logs.push(m.line);
          } else if (m.t === 'result') {
            App.markDirty();
            finish({ ok: true, result: m.result == null ? 'Done.' : m.result, logs, sandbox: 'worker' });
          } else if (m.t === 'error') {
            finish({ ok: false, error: m.error, logs, sandbox: 'worker' });
          }
        };
        worker.onerror = (e) => finish({ ok: false, error: String((e && e.message) || 'worker error'), logs, sandbox: 'worker' });
        try { worker.postMessage({ t: 'run', code }); }
        catch (err) { finish({ ok: false, error: String(err && err.message || err), logs, sandbox: 'worker' }); }
      });
    },

    // script that runs INSIDE the worker: penfig proxy → postMessage RPC.
    _workerBootstrap() {
      return `
(function () {
  'use strict';
  var pending = [], seq = 0;
  function pushLog(args) {
    var line = Array.prototype.map.call(args, function (x) {
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }).join(' ');
    try { postMessage({ t: 'log', line: line }); } catch (e) { }
  }
  var consoleStub = {
    log: function () { pushLog(arguments); },
    warn: function () { pushLog(arguments); },
    error: function () { pushLog(arguments); }
  };
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var s = ++seq;
    return new Promise(function (res, rej) {
      pending.push({ seq: s, cb: function (e) { e instanceof Error ? rej(e) : res(e); } });
      postMessage({ t: 'call', seq: s, name: name, args: args });
    });
  }
  var penfig = {
    doc: function () { return call('doc'); },
    setMode: function (id) { return call('setMode', id); },
    selection: function () { return call('selection'); },
    setSelection: function (ids) { return call('setSelection', ids); },
    listNodes: function () { return call('listNodes'); },
    getNode: function (id) { return call('getNode', id); },
    setPos: function (id, x, y) { return call('setPos', id, x, y); },
    setProps: function (id, p) { return call('setProps', id, p); },
    create: function (t, p) { return call('create', t, p); },
    remove: function (id) { return call('remove', id); },
    history: { begin: function () { return call('historyBegin'); }, end: function () { return call('historyEnd'); } },
    refresh: function () { return call('refresh'); },
    toast: function (m) { return call('toast', m); }
  };
  self.onmessage = function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.t === 'res') {
      for (var i = 0; i < pending.length; i++) {
        if (pending[i].seq === m.seq) {
          var entry = pending.splice(i, 1)[0];
          if (m.error) entry.cb(new Error(m.error)); else entry.cb(m.result);
          return;
        }
      }
      return;
    }
    if (m.t !== 'run') return;
    try {
      var fn = new Function('penfig', 'console', '"use strict";\\nreturn (async () => {\\n' + m.code + '\\n})();');
      var p = fn(penfig, consoleStub);
      Promise.resolve(p).then(
        function (r) { postMessage({ t: 'result', result: r == null ? null : String(r) }); },
        function (err) { postMessage({ t: 'error', error: String(err && err.message || err) }); });
    } catch (err) {
      postMessage({ t: 'error', error: String(err && err.message || err) });
    }
  };
})();
`;
    },

    // ------------------------------------------------------------- plugin UI
    // bridge script injected into the UI iframe before the plugin code.
    // UI code calls penfig.call(name, ...args) → parent postMessage →
    // handleRpc (same whitelist as headless plugins).
    _uiBridge() {
      return `
<script>
(function () {
  'use strict';
  var pending = [], seq = 0;
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.t !== 'pf-rpc-res') return;
    var entry = pending.find(function (p) { return p.seq === m.seq; });
    if (!entry) return;
    pending.splice(pending.indexOf(entry), 1);
    if (m.error) entry.cb(new Error(m.error)); else entry.cb(m.result);
  });
  window.penfig = {
    call: function (name) {
      var args = Array.prototype.slice.call(arguments, 1);
      var s = ++seq;
      return new Promise(function (res, rej) {
        pending.push({ seq: s, cb: function (e) { e instanceof Error ? rej(e) : res(e); } });
        parent.postMessage({ t: 'pf-rpc', seq: s, name: name, args: args }, '*');
      });
    },
    history: { begin: function () { return window.penfig.call('historyBegin'); }, end: function () { return window.penfig.call('historyEnd'); } },
    toast: function (m) { return window.penfig.call('toast', m); }
  };
})();
</script>`;
    },

    // run a plugin with a UI panel: modal + sandboxed iframe(srcdoc) + RPC bridge.
    // logFn(line) receives toasts/errors for the host's console area.
    runUI(code, uiCode, App, logFn) {
      logFn = logFn || function () { };
      const modal = document.createElement('div');
      modal.className = 'pf-modal';
      modal.innerHTML = `
        <div class="pf-modal-card" style="width:380px">
          <div class="pf-modal-head"><b>Plugin UI</b><button class="ed-iconbtn pf-modal-x" title="Close">&times;</button></div>
          <iframe class="pf-ui-frame" sandbox="allow-scripts" style="width:100%;height:260px;border:1px solid #444;border-radius:6px;background:#17171c"></iframe>
          <pre class="pl-out" style="display:none;margin-top:8px"></pre>
        </div>`;
      document.body.appendChild(modal);
      const out = modal.querySelector('.pl-out');
      const log = (line) => {
        out.style.display = '';
        out.textContent = (out.textContent ? out.textContent + '\n' : '') + line;
        out.scrollTop = out.scrollHeight;
        logFn(line);
      };
      const embed = (src) => '<script>(async () => { try {\n' + (src || '') +
        '\n} catch (e) { parent.postMessage({ t: "pf-ui-error", error: String(e && e.message || e) }, "*"); } })();<\/script>';
      const srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:12px;font:13px/1.5 system-ui,sans-serif;color:#e5e5e5;background:transparent">' +
        this._uiBridge() +
        embed(code) +
        embed(uiCode) +
        '</body></html>';
      const frame = modal.querySelector('.pf-ui-frame');
      frame.srcdoc = srcdoc;
      const onMsg = (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.t === 'pf-rpc') {
          let result = null;
          try {
            result = this.handleRpc(App, m.name, m.args || []);
          } catch (err) {
            if (frame.contentWindow) frame.contentWindow.postMessage({ t: 'pf-rpc-res', seq: m.seq, error: String(err && err.message || err) }, '*');
            return;
          }
          if (frame.contentWindow) frame.contentWindow.postMessage({ t: 'pf-rpc-res', seq: m.seq, result }, '*');
        } else if (m.t === 'pf-ui-error') {
          log('UI error: ' + m.error);
        }
      };
      window.addEventListener('message', onMsg);
      const close = () => { modal.remove(); window.removeEventListener('message', onMsg); };
      modal.querySelector('.pf-modal-x').addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      return { modal, close };
    },
  };

  global.Plugins = Plugins;
})(window);
