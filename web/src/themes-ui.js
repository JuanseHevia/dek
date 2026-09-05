// Design systems in the chrome. The pill is the way in; the left sidebar lists
// what exists; clicking one puts its composition — the guidelines, written in
// the system itself — on the stage. Pure view code: every mutation goes back
// out through the `actions` the shell passes in.

import { currentSystem, currentVersion, themeSummary, MAX_THEMES } from './theme.js';
import { composeDocument, DOC_WIDTH } from './theme-doc.js';

const text = (tag, cls, value) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (value !== undefined) el.textContent = value;
  return el;
};

function swatchStrip(colors, cls = 'theme-swatch') {
  const el = text('span', cls);
  el.setAttribute('aria-hidden', 'true');
  for (const c of colors.slice(0, 6)) {
    const dot = text('i');
    dot.style.background = c || 'transparent';
    el.appendChild(dot);
  }
  return el;
}

function relDay(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function createThemesUI({ els, actions }) {
  let open = false;        // the sidebar is showing design systems
  let selectedId = null;   // whose composition is on the stage
  let historyOpen = false;
  let confirmDelete = null;
  let docKey = '';         // what the iframe currently holds

  const list = () => actions.list();
  const selected = () => (selectedId ? list().find((t) => t.id === selectedId) || null : null);

  // ---------- the pill button ----------

  function renderButton() {
    const active = actions.active();
    els.designbtn.classList.toggle('active', open);
    els.designbtn.classList.toggle('stale', !!(active && active.stale));
    els.designlabel.textContent = active ? active.theme.name : 'Design';
    els.designbtn.title = active
      ? `${active.theme.name} v${active.appliedVersion}${active.stale ? ` · v${currentVersion(active.theme)} is newer` : ''} — design systems (⌥⌘D)`
      : 'Design systems (⌥⌘D)';
    els.designswatch.replaceChildren(
      ...(active ? Array.from(swatchStrip(themeSummary(active.theme).swatches.slice(0, 3)).childNodes) : []),
    );
    els.designswatch.hidden = !active;
  }

  // ---------- the sidebar list ----------

  function card(theme) {
    const active = actions.active();
    const s = themeSummary(theme);
    const isOn = !!active && active.theme.id === theme.id;
    const el = text('div', 'ds-item' + (theme.id === selectedId ? ' current' : '') + (isOn ? ' applied' : ''));
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(theme.id === selectedId));
    el.tabIndex = -1;

    const head = text('div', 'ds-item-head');
    head.appendChild(swatchStrip(s.swatches));
    head.appendChild(text('span', 'ds-name', theme.name));
    if (isOn) {
      const dot = text('span', 'ds-on');
      dot.title = active.stale ? `on this deck at v${active.appliedVersion}; v${s.version} is newer` : 'on this deck';
      dot.textContent = active.stale ? '↑' : '●';
      head.appendChild(dot);
    }
    el.appendChild(head);
    el.appendChild(text('span', 'ds-sub', `${s.mode} · ${s.fonts.display} · v${s.version}`));
    el.addEventListener('click', () => select(theme.id));
    return el;
  }

  function renderList() {
    if (!open) return;
    const themes = list();
    els.dslist.replaceChildren(...themes.map(card));
    els.dsempty.hidden = themes.length > 0;
    els.navcount.textContent = `${themes.length}/${MAX_THEMES}`;
    els.dscapture.disabled = themes.length >= MAX_THEMES;
    els.dscapture.title = themes.length >= MAX_THEMES
      ? `Delete a system first: the library holds ${MAX_THEMES}.`
      : 'Start a system from the look this deck already has';
  }

  // ---------- the composition ----------

  function renderHistory() {
    const theme = selected();
    els.composehist.hidden = !historyOpen || !theme;
    if (!historyOpen || !theme) return;
    const now = currentVersion(theme);
    els.composehist.replaceChildren(...[...theme.versions].reverse().map((v) => {
      const line = text('div', 'theme-rev' + (v.v === now ? ' current' : ''));
      line.appendChild(text('span', 'v', `v${v.v}`));
      line.appendChild(text('span', 'note', v.note || 'updated'));
      line.appendChild(text('span', 'when', relDay(v.at)));
      line.appendChild(swatchStrip([v.system.color.bg, v.system.color.ink, v.system.color.accent], 'theme-swatch mini'));
      if (v.v === now) line.appendChild(text('span', 'hint', 'in force'));
      else {
        const b = text('button', 'setbtn', 'Restore');
        b.addEventListener('click', () => actions.revert(theme.id, v.v));
        line.appendChild(b);
      }
      return line;
    }));
  }

  function renderCompose() {
    const theme = selected();
    els.compose.hidden = !theme;
    document.body.classList.toggle('composing', !!theme);
    if (!theme) { docKey = ''; return; }
    const active = actions.active();
    const isOn = !!active && active.theme.id === theme.id;
    const v = currentVersion(theme);
    els.composename.textContent = theme.name;
    els.composever.textContent = isOn
      ? (active.stale ? `on this deck at v${active.appliedVersion} · v${v} is newer` : `on this deck · v${v}`)
      : `v${v} · ${theme.versions.length} version${theme.versions.length === 1 ? '' : 's'}`;
    els.composeapply.textContent = isOn && !active.stale ? 'Re-apply' : 'Apply to Deck';
    els.composeapply.classList.toggle('primary', isOn && active.stale);
    els.composehistorybtn.textContent = historyOpen ? 'Hide History' : 'History';
    els.composedelete.textContent = confirmDelete === theme.id ? 'Really Delete' : 'Delete';
    els.composedelete.classList.toggle('on', confirmDelete === theme.id);

    // rebuilding the document reloads the iframe, so only do it when it changed
    const key = `${theme.id}@${v}@${theme.updatedAt}@${theme.name}`;
    if (key !== docKey) {
      docKey = key;
      els.composeframe.srcdoc = composeDocument(theme);
    }
    // the pane has no measurable size in the frame it is revealed in
    fitCompose();
    requestAnimationFrame(fitCompose);
    setTimeout(fitCompose, 80);
    renderHistory();
  }

  /** The composition is authored at a fixed width; scale it down only when the pane is narrower. */
  function fitCompose() {
    const view = els.composeframe.parentElement;
    if (!view) return;
    const w = view.clientWidth;
    const h = view.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(1, w / DOC_WIDTH);
    els.composeframe.style.width = DOC_WIDTH + 'px';
    els.composeframe.style.height = Math.ceil(h / scale) + 'px';
    els.composeframe.style.transform = `scale(${scale})`;
  }

  function select(id) {
    selectedId = id;
    historyOpen = false;
    confirmDelete = null;
    renderList();
    renderCompose();
  }

  function setOpen(on) {
    open = !!on;
    if (!open) { selectedId = null; historyOpen = false; confirmDelete = null; }
    document.body.classList.toggle('design-mode', open);
    els.thumbs.hidden = open;
    els.dslist.hidden = !open;
    els.dsempty.hidden = true;
    els.navback.hidden = !open;
    els.addslide.hidden = open;
    els.dscapture.hidden = !open;
    els.dsask.hidden = !open;
    els.navtitle.textContent = open ? 'Design systems' : 'Slides';
    if (open) { actions.showNav(); renderList(); }
    renderCompose();
    renderButton();
    return open;
  }

  // ---------- wiring ----------

  els.designbtn.addEventListener('click', () => setOpen(!open));
  els.navback.addEventListener('click', () => setOpen(false));
  els.composeclose.addEventListener('click', () => select(null));
  els.dscapture.addEventListener('click', () => actions.capture());
  els.dsask.addEventListener('click', () => actions.ask());
  els.composeask.addEventListener('click', () => { const t = selected(); if (t) actions.ask(t.id); });
  els.composeapply.addEventListener('click', () => { const t = selected(); if (t) actions.apply(t.id); });
  els.composeduplicate.addEventListener('click', () => { const t = selected(); if (t) actions.duplicate(t.id); });
  els.composesave.addEventListener('click', () => { const t = selected(); if (t) actions.save(t.id, composeDocument(t)); });
  els.composehistorybtn.addEventListener('click', () => { historyOpen = !historyOpen; renderCompose(); });
  els.composedelete.addEventListener('click', () => {
    const t = selected();
    if (!t) return;
    if (confirmDelete !== t.id) {
      confirmDelete = t.id;
      renderCompose();
      setTimeout(() => { if (confirmDelete === t.id) { confirmDelete = null; renderCompose(); } }, 4000);
      return;
    }
    confirmDelete = null;
    actions.remove(t.id);
  });
  window.addEventListener('resize', fitCompose);
  // the pane has no size until it is shown, and the iframe none until it loads
  els.composeframe.addEventListener('load', fitCompose);
  if (window.ResizeObserver && els.composeframe.parentElement) {
    new ResizeObserver(fitCompose).observe(els.composeframe.parentElement);
  }

  return {
    render() { renderButton(); renderList(); renderCompose(); },
    setOpen,
    isOpen: () => open,
    toggle() { return setOpen(!open); },
    select,
    selectedId: () => selectedId,
    /** Esc unwinds one step: composition first, then the list. */
    escape() {
      if (selectedId) { select(null); return true; }
      if (open) { setOpen(false); return true; }
      return false;
    },
    fit: fitCompose,
  };
}
