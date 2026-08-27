/* dialogs.js — shared Promise-based confirm/prompt/alert dialogs.
 *
 * Replaces the browser's native prompt()/confirm()/alert(), which block the
 * main thread, cannot be styled, look completely out of place next to the
 * rest of the editor chrome, and (worse) freeze rendering + collaboration
 * updates for the whole tab while open. These render as normal
 * .pf-modal / .pf-modal-card overlays so they match every other dialog in
 * the app, participate in the same Escape/backdrop-click handling as other
 * modals, and never block the event loop.
 *
 * Usage:
 *   const ok = await Dialogs.confirm('Delete “Page 2”?');
 *   const name = await Dialogs.prompt('Rename layer', n.name);
 *   await Dialogs.alert('Recovery failed: ' + e.message);
 *
 * confirm() resolves to a boolean. prompt() resolves to the entered string,
 * or null if cancelled (matches native prompt() semantics so call sites that
 * do `const name = prompt(...); if (name) ...` need only add `await`).
 */
(function (global) {
  'use strict';

  function buildBackdrop() {
    const back = document.createElement('div');
    back.className = 'pf-modal pf-dialog-backdrop';
    const card = document.createElement('div');
    card.className = 'pf-modal-card pf-dialog-card';
    back.appendChild(card);
    document.body.appendChild(back);
    return { back, card };
  }

  function closeWith(back, resolve, value) {
    back.classList.add('pf-dialog-closing');
    setTimeout(() => { if (back.parentNode) back.parentNode.removeChild(back); }, 90);
    resolve(value);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // confirm(message, opts?) -> Promise<boolean>
  function confirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const { back, card } = buildBackdrop();
      card.innerHTML = `
        <div class="pf-modal-head pf-dialog-head">${esc(opts.title || 'Are you sure?')}</div>
        <div class="pf-dialog-body"><p class="pf-dialog-msg">${esc(message)}</p></div>
        <div class="pf-modal-foot pf-dialog-foot">
          <button type="button" class="ed-btn" data-dlg="cancel">${esc(opts.cancelLabel || 'Cancel')}</button>
          <button type="button" class="ed-btn ${opts.danger ? 'ed-btn-danger' : 'ed-btn-primary'}" data-dlg="ok">${esc(opts.okLabel || 'Delete')}</button>
        </div>`;
      const okBtn = card.querySelector('[data-dlg="ok"]');
      const cancelBtn = card.querySelector('[data-dlg="cancel"]');
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      };
      function finish(v) {
        card.removeEventListener('keydown', onKey, true);
        back.removeEventListener('click', onBackdropClick);
        closeWith(back, resolve, v);
      }
      function onBackdropClick(e) { if (e.target === back) finish(false); }
      back.addEventListener('click', onBackdropClick);
      card.addEventListener('keydown', onKey, true);
      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      requestAnimationFrame(() => okBtn.focus());
    });
  }

  // prompt(message, defaultValue?, opts?) -> Promise<string|null>
  function prompt(message, defaultValue, opts) {
    opts = opts || {};
    defaultValue = defaultValue == null ? '' : String(defaultValue);
    return new Promise((resolve) => {
      const { back, card } = buildBackdrop();
      const multiline = String(message || '').indexOf('\n') !== -1;
      card.innerHTML = `
        <div class="pf-modal-head pf-dialog-head">${esc(opts.title || message || 'Enter a value')}</div>
        <div class="pf-dialog-body">
          ${opts.title ? `<p class="pf-dialog-msg">${esc(message)}</p>` : ''}
          <input type="text" class="pf-dialog-input" data-dlg="input" value="${esc(defaultValue)}" ${multiline ? '' : ''} />
        </div>
        <div class="pf-modal-foot pf-dialog-foot">
          <button type="button" class="ed-btn" data-dlg="cancel">Cancel</button>
          <button type="button" class="ed-btn ed-btn-primary" data-dlg="ok">${esc(opts.okLabel || 'OK')}</button>
        </div>`;
      const input = card.querySelector('[data-dlg="input"]');
      const okBtn = card.querySelector('[data-dlg="ok"]');
      const cancelBtn = card.querySelector('[data-dlg="cancel"]');
      function finish(v) {
        input.removeEventListener('keydown', onKey);
        back.removeEventListener('click', onBackdropClick);
        closeWith(back, resolve, v);
      }
      function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      }
      function onBackdropClick(e) { if (e.target === back) finish(null); }
      back.addEventListener('click', onBackdropClick);
      input.addEventListener('keydown', onKey);
      okBtn.addEventListener('click', () => finish(input.value));
      cancelBtn.addEventListener('click', () => finish(null));
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  // alert(message, opts?) -> Promise<void>
  function alertDlg(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const { back, card } = buildBackdrop();
      card.innerHTML = `
        <div class="pf-modal-head pf-dialog-head">${esc(opts.title || (opts.error ? 'Something went wrong' : 'Notice'))}</div>
        <div class="pf-dialog-body"><p class="pf-dialog-msg">${esc(message)}</p></div>
        <div class="pf-modal-foot pf-dialog-foot">
          <button type="button" class="ed-btn ed-btn-primary" data-dlg="ok">OK</button>
        </div>`;
      const okBtn = card.querySelector('[data-dlg="ok"]');
      function finish() {
        back.removeEventListener('click', onBackdropClick);
        card.removeEventListener('keydown', onKey);
        closeWith(back, resolve, undefined);
      }
      function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish(); } }
      function onBackdropClick(e) { if (e.target === back) finish(); }
      back.addEventListener('click', onBackdropClick);
      card.addEventListener('keydown', onKey);
      okBtn.addEventListener('click', finish);
      requestAnimationFrame(() => okBtn.focus());
    });
  }

  global.Dialogs = { confirm, prompt, alert: alertDlg };
})(typeof window !== 'undefined' ? window : globalThis);
