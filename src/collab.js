/* collab.js — real-time collaboration over BroadcastChannel.
 *
 * Live multiplayer between browser tabs/windows on the same origin:
 * cursors, selections, and full-document edits (last-write-wins per rev).
 * The same message protocol is what a WebSocket relay would carry for
 * cross-machine sync — the UI only talks to Collab.send* / onPeersChange.
 */
(function (global) {
  'use strict';
  const M = global.Model;
  const COLORS = ['#f24e1e', '#0d99ff', '#12b76a', '#a259ff', '#f79009', '#e11d74', '#36b37e', '#ff8787'];

  const Collab = {
    ch: null,
    self: null,
    peers: new Map(),
    onPeersChange: null,
    onCursor: null,
    remoteApplying: false,
    _saveDebounce: 0,
    _cursorThrottle: 0,

    join(docId) {
      if (!('BroadcastChannel' in globalThis)) return false;
      this.leave();
      const name = 'Guest-' + Math.floor(100 + Math.random() * 900);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.self = { id: M.uid('peer-'), name, color };
      this.ch = new BroadcastChannel('penfig-collab-' + docId);
      const self = this;
      this.ch.onmessage = (e) => self._onMsg(e.data);
      this.ch.postMessage({ t: 'hello', id: this.self.id, name, color });
      setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [pid, p] of this.peers) if (now - p.seen > 6000) { this.peers.delete(pid); changed = true; }
        if (changed) this._emitPeers();
      }, 2000);
      return true;
    },
    leave() {
      if (this._expireTimer) { clearInterval(this._expireTimer); this._expireTimer = null; }
      if (this._saveDebounce) { clearTimeout(this._saveDebounce); this._saveDebounce = 0; }
      if (this.ch) {
        try { this.ch.postMessage({ t: 'bye', id: this.self ? this.self.id : null }); } catch (e) { }
        this.ch.close();
        this.ch = null;
      }
      this.peers.clear();
    },
    active() { return !!this.ch; },

    _onMsg(m) {
      if (!m || !m.t || m.id === (this.self && this.self.id)) return;
      if (m.t === 'hello' || m.t === 'hello-ack') {
        const isNew = !this.peers.has(m.id);
        this.peers.set(m.id, { id: m.id, name: m.name, color: m.color, seen: Date.now(), cursor: null, sel: [] });
        if (m.t === 'hello' && this.ch) this.ch.postMessage({ t: 'hello-ack', id: this.self.id, name: this.self.name, color: this.self.color });
        if (isNew) this._emitPeers();
      } else if (m.t === 'bye') {
        if (this.peers.delete(m.id)) this._emitPeers();
      } else if (m.t === 'cursor') {
        const p = this.peers.get(m.id);
        if (p) { p.cursor = { x: m.x, y: m.y }; p.seen = Date.now(); if (this.onCursor) this.onCursor(m.id, p); }
      } else if (m.t === 'selection') {
        const p = this.peers.get(m.id);
        if (p) { p.sel = m.ids || []; p.seen = Date.now(); }
      } else if (m.t === 'doc') {
        const App = global.App;
        if (!App || !App.doc || App.doc.id !== m.docId || this.remoteApplying) return;
        const localRev = App.doc._rev || 0;
        if (localRev >= (m.rev || 0)) return; // we're newer; sender will get our state on next edit
        this.remoteApplying = true;
        const d = m.doc;
        App.doc.name = d.name;
        App.doc.pages = d.pages;
        App.doc.vars = d.vars;
        App.doc.components = d.components || {};
        App.doc.comments = d.comments || [];
        App.doc._rev = m.rev;
        const pageStillThere = App.doc.pages.some(p => p.id === App.page.id);
        if (!pageStillThere) App.pageIndex = 0;
        App.sel = (m.sel || []).filter(id => App.doc.pages.some(p => p.nodes[id]));
        App.markDirty();
        if (global.Panels && global.Panels.refreshInspector) global.Panels.refreshInspector();
        this.remoteApplying = false;
      }
    },

    _emitPeers() { if (this.onPeersChange) this.onPeersChange([...this.peers.values()]); },

    sendCursor(x, y) {
      if (!this.ch) return;
      const now = Date.now();
      if (now - this._cursorThrottle < 40) return;
      this._cursorThrottle = now;
      this.ch.postMessage({ t: 'cursor', id: this.self.id, x, y });
    },
    sendSelection(ids) {
      if (!this.ch) return;
      this.ch.postMessage({ t: 'selection', id: this.self.id, ids: ids || [] });
    },
    // debounced full-doc broadcast (call from the dirty path)
    broadcastDoc(doc, sel) {
      if (!this.ch || this.remoteApplying) return;
      clearTimeout(this._saveDebounce);
      const self = this;
      this._saveDebounce = setTimeout(() => {
        if (!self.ch) return;
        doc._rev = (doc._rev || 0) + 1;
        self.ch.postMessage({
          t: 'doc', docId: doc.id, rev: doc._rev, sel: sel || [],
          doc: { name: doc.name, pages: doc.pages, vars: doc.vars, components: doc.components || {}, comments: doc.comments || [] },
        });
      }, 300);
    },
  };

  global.Collab = Collab;
})(window);
