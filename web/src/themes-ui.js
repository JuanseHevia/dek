// Design systems in the chrome: the nav-bar button, the switcher popover and
// the management panel. Pure view code — every mutation goes back out through
// the `actions` the shell passes in.

import { currentSystem, currentVersion, themeSummary, MAX_THEMES } from './theme.js';

const CHEVRON = '<svg class="theme-chev" width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4.2 4.5 1 8 4.2"/></svg>';
const CHECK = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4.6 4 7.5 10 1.3"/></svg>';

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

/**
 * @param els     the theme elements from index.html
 * @param actions what the shell can do: list/active/apply/detach/remove/rename/revert/duplicate/capture/ask
 */
export function createThemesUI({ els, actions }) {
  let panelOpen = false;
  let openHistory = null;   // id whose version list is expanded
  let confirmDelete = null; // id armed for deletion

  // ---------- the nav-bar button ----------

  function renderButton() {
    const active = actions.active();
    const stale = active && active.stale;
    els.themename.textContent = active ? active.theme.name : 'No design system';
    els.themebtn.classList.toggle('none', !active);
    els.themebtn.classList.toggle('stale', !!stale);
    els.themebtn.title = active
      ? `Design system: ${active.theme.name} v${active.appliedVersion}${stale ? ` · v${currentVersion(active.theme)} is newer` : ''} (⌥⌘D)`
      : 'Choose a design system for this deck (⌥⌘D)';
    els.themeswatch.replaceChildren(...(active
      ? Array.from(swatchStrip(themeSummary(active.theme).swatches).childNodes)
      : Array.from(swatchStrip(['transparent', 'transparent', 'transparent']).childNodes)));
    els.themeversion.textContent = active ? `v${active.appliedVersion}${stale ? '+' : ''}` : '';
  }

  // ---------- the switcher popover ----------

  function row({ label, hint, on, danger, run, swatches, sub }) {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    if (danger) b.className = 'danger';
    if (on) b.classList.add('on');
    const check = text('span', 'theme-check');
    check.innerHTML = on ? CHECK : '';
    b.appendChild(check);
    if (swatches) b.appendChild(swatchStrip(swatches, 'theme-swatch mini'));
    const stack = text('span', 'theme-row-text');
    stack.appendChild(text('span', 'nm', label));
    if (sub) stack.appendChild(text('span', 'sub', sub));
    b.appendChild(stack);
    if (hint) b.appendChild(text('span', 'hint', hint));
    b.addEventListener('click', () => { closeMenu(); run(); });
    return b;
  }

  function renderMenu() {
    const themes = actions.list();
    const active = actions.active();
    const menu = els.thememenu;
    menu.replaceChildren();
    if (!themes.length) {
      const empty = text('p', 'theme-menu-empty', 'No design systems yet. Ask Claude Code to build one, or capture the look of this deck.');
      menu.appendChild(empty);
    }
    for (const theme of themes) {
      const s = themeSummary(theme);
      const isActive = !!active && active.theme.id === theme.id;
      menu.appendChild(row({
        label: theme.name,
        sub: `${s.mode} · ${s.fonts.display} · v${s.version}`,
        hint: isActive && active.stale ? 'update' : '',
        on: isActive,
        swatches: s.swatches,
        run: () => actions.apply(theme.id),
      }));
    }
    menu.appendChild(document.createElement('hr'));
    if (active) menu.appendChild(row({ label: 'Remove From This Deck', run: () => actions.detach() }));
    menu.appendChild(row({ label: 'Save This Deck’s Look As a System…', run: () => actions.capture() }));
    menu.appendChild(row({ label: 'Design Systems…', hint: `${themes.length} / ${MAX_THEMES}`, run: () => setPanelOpen(true) }));
    menu.appendChild(row({ label: 'Ask Claude Code For One', run: () => actions.ask() }));
  }

  function openMenu() {
    renderMenu();
    els.thememenu.hidden = false;
    const b = els.themebtn.getBoundingClientRect();
    const m = els.thememenu.getBoundingClientRect();
    els.thememenu.style.left = Math.max(8, b.left) + 'px';
    els.thememenu.style.top = Math.max(8, b.top - m.height - 8) + 'px';
    els.themebtn.classList.add('open');
  }
  function closeMenu() {
    if (els.thememenu.hidden) return;
    els.thememenu.hidden = true;
    els.themebtn.classList.remove('open');
  }
  const menuOpen = () => !els.thememenu.hidden;

  // ---------- the management panel ----------

  function field(value, placeholder, cls, commit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.value = value || '';
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = value || ''; input.blur(); }
    });
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('blur', () => commit(input.value));
    return input;
  }

  function action(label, run, cls = '') {
    const b = text('button', `setbtn ${cls}`.trim(), label);
    b.addEventListener('click', run);
    return b;
  }

  function historyList(theme) {
    const box = text('div', 'theme-history');
    const now = currentVersion(theme);
    for (const v of [...theme.versions].reverse()) {
      const line = text('div', 'theme-rev' + (v.v === now ? ' current' : ''));
      line.appendChild(text('span', 'v', `v${v.v}`));
      line.appendChild(text('span', 'note', v.note || 'updated'));
      line.appendChild(text('span', 'when', relDay(v.at)));
      line.appendChild(swatchStrip([v.system.color.bg, v.system.color.ink, v.system.color.accent], 'theme-swatch mini'));
      if (v.v === now) line.appendChild(text('span', 'hint', 'in force'));
      else line.appendChild(action('Restore', () => actions.revert(theme.id, v.v)));
      box.appendChild(line);
    }
    return box;
  }

  function tokenLine(label, value) {
    const line = text('div', 'theme-token');
    line.appendChild(text('span', 'k', label));
    line.appendChild(text('span', 'v', value));
    return line;
  }

  function themeCard(theme) {
    const active = actions.active();
    const isActive = !!active && active.theme.id === theme.id;
    const s = themeSummary(theme);
    const system = currentSystem(theme);
    const card = text('div', 'theme-card' + (isActive ? ' active' : ''));

    const head = text('div', 'theme-card-head');
    head.appendChild(swatchStrip(s.swatches));
    const names = text('div', 'theme-card-names');
    names.appendChild(field(theme.name, 'Name', 'theme-title', (v) => actions.rename(theme.id, { name: v })));
    names.appendChild(field(theme.description, 'What it is for', 'theme-desc', (v) => actions.rename(theme.id, { description: v })));
    head.appendChild(names);
    const badge = text('span', 'theme-badge', isActive ? (active.stale ? `v${active.appliedVersion} → v${s.version}` : `on this deck · v${s.version}`) : `v${s.version}`);
    head.appendChild(badge);
    card.appendChild(head);

    const tokens = text('div', 'theme-tokens');
    tokens.appendChild(tokenLine('Mode', system.meta.mode + (s.mood ? ` · ${s.mood}` : '')));
    tokens.appendChild(tokenLine('Type', `${s.fonts.display} / ${s.fonts.body} · ${system.typography.scale.h1} headings`));
    tokens.appendChild(tokenLine('Motion', `${system.motion.transition} ${system.motion.transitionMs}ms · fragments ${system.motion.fragment}`));
    tokens.appendChild(tokenLine('Charts', `${(system.chart.palette.length ? system.chart.palette : system.color.series).length} series · grid ${system.chart.grid ? 'on' : 'off'}${system.chart.values ? ' · values on' : ''}`));
    const comps = Object.keys(system.components || {});
    tokens.appendChild(tokenLine('Components', comps.length ? comps.join(', ') : 'none'));
    tokens.appendChild(tokenLine('History', `${theme.versions.length} version${theme.versions.length === 1 ? '' : 's'} · updated ${relDay(theme.updatedAt)}`));
    card.appendChild(tokens);

    const bar = text('div', 'theme-card-actions');
    bar.appendChild(action(isActive && !active.stale ? 'Re-apply' : 'Apply to Deck', () => actions.apply(theme.id), isActive && active.stale ? 'primary' : ''));
    bar.appendChild(action(openHistory === theme.id ? 'Hide History' : 'History', () => { openHistory = openHistory === theme.id ? null : theme.id; renderPanel(); }));
    bar.appendChild(action('Duplicate', () => actions.duplicate(theme.id)));
    bar.appendChild(action('Edit With Claude Code', () => actions.ask(theme.id)));
    const spacer = text('span', 'nav-spacer');
    bar.appendChild(spacer);
    bar.appendChild(action(confirmDelete === theme.id ? 'Really Delete' : 'Delete', () => {
      if (confirmDelete !== theme.id) { confirmDelete = theme.id; renderPanel(); setTimeout(() => { if (confirmDelete === theme.id) { confirmDelete = null; renderPanel(); } }, 4000); return; }
      confirmDelete = null;
      actions.remove(theme.id);
    }, confirmDelete === theme.id ? 'danger on' : 'danger'));
    card.appendChild(bar);

    if (openHistory === theme.id) card.appendChild(historyList(theme));
    return card;
  }

  function renderPanel() {
    if (!panelOpen) return;
    // never rebuild the cards while a name or description is being typed into
    if (els.themeslist.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const themes = actions.list();
    els.themescount.textContent = `${themes.length} of ${MAX_THEMES}`;
    els.themesempty.hidden = themes.length > 0;
    els.themeslist.replaceChildren(...themes.map(themeCard));
    els.themesnew.disabled = themes.length >= MAX_THEMES;
    els.themesnew.title = themes.length >= MAX_THEMES ? `Delete a system first: the library holds ${MAX_THEMES}.` : 'Start a system from the look this deck already has';
  }

  function setPanelOpen(on) {
    panelOpen = !!on;
    openHistory = null;
    confirmDelete = null;
    els.themes.hidden = !panelOpen;
    if (panelOpen) { closeMenu(); renderPanel(); }
    return panelOpen;
  }

  // ---------- wiring ----------

  els.themebtn.addEventListener('click', () => (menuOpen() ? closeMenu() : openMenu()));
  els.themesclose.addEventListener('click', () => setPanelOpen(false));
  els.themesnew.addEventListener('click', () => actions.capture());
  els.themesask.addEventListener('click', () => actions.ask());
  document.addEventListener('mousedown', (e) => {
    if (!menuOpen()) return;
    if (!e.target.closest('#thememenu') && !e.target.closest('#themebtn')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  return {
    render() { renderButton(); renderMenu(); renderPanel(); },
    openMenu, closeMenu, menuOpen,
    setPanelOpen,
    panelOpen: () => panelOpen,
    toggle() { if (panelOpen) { setPanelOpen(false); return; } if (menuOpen()) closeMenu(); else openMenu(); },
  };
}
