// Quick open: one widget, VS Code-style. Plain text finds a slide by number
// or title; a leading ">" searches commands.

/** Subsequence fuzzy match: -1 if query isn't a subsequence of target, else higher is better. */
export function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0, score = 0, streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { qi++; streak++; score += streak; }
    else streak = 0;
  }
  if (qi < q.length) return -1;
  return score + Math.max(0, 6 - t.indexOf(q[0]));
}

export function createPalette({ root, input, list, empty, commands, slides, onSlide, onClose }) {
  let mode = 'slide';
  let results = [];
  let index = 0;

  function render() {
    const raw = input.value;
    mode = raw.trim().startsWith('>') ? 'command' : 'slide';
    input.placeholder = mode === 'command' ? 'Type a command…' : 'Go to slide, or type > for commands…';

    if (mode === 'command') {
      const query = raw.trim().slice(1).trim();
      const all = commands().filter((c) => !c.hidden || (c.hidden && query));
      results = !query
        ? all.filter((c) => !c.hidden)
        : all.map((c) => ({ c, score: fuzzyScore(query, c.label) })).filter((r) => r.score >= 0).sort((a, b) => b.score - a.score).map((r) => r.c);
    } else {
      const query = raw.trim();
      const all = slides();
      if (!query) results = all;
      else if (/^\d+$/.test(query)) results = all.filter((s) => String(s.index + 1).startsWith(query));
      else results = all.map((s) => ({ s, score: fuzzyScore(query, `${s.index + 1} ${s.title}`) })).filter((r) => r.score >= 0).sort((a, b) => b.score - a.score).map((r) => r.s);
    }

    index = 0;
    list.innerHTML = '';
    empty.hidden = !!results.length;
    empty.textContent = mode === 'command' ? 'No matching commands.' : (slides().length ? 'No matching slides.' : 'Open a deck first.');
    results.forEach((item, i) => {
      const row = document.createElement('button');
      row.className = 'qo-item' + (i === index ? ' active' : '');
      row.setAttribute('role', 'option');
      if (mode === 'slide') {
        const n = document.createElement('span');
        n.className = 'qo-num';
        n.textContent = String(item.index + 1);
        row.appendChild(n);
      }
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = mode === 'command' ? item.label : (item.title || 'Untitled slide');
      row.appendChild(nm);
      const hintText = mode === 'command' ? item.hint : (item.current ? 'current' : '');
      if (hintText) {
        const hint = document.createElement('span');
        hint.className = 'qo-hint';
        hint.textContent = hintText;
        row.appendChild(hint);
      }
      row.addEventListener('click', () => run(i));
      list.appendChild(row);
    });
  }

  function setIndex(i) {
    if (!results.length) return;
    index = (i + results.length) % results.length;
    [...list.children].forEach((el, n) => el.classList.toggle('active', n === index));
    list.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const item = results[i];
    if (!item) return;
    close();
    if (mode === 'command') item.run();
    else onSlide(item.index);
  }

  function open(opts) {
    root.hidden = false;
    input.value = opts && opts.command ? '> ' : '';
    render();
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    onClose && onClose();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(index + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(index - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(index); }
    else if (e.key === 'Tab') { e.preventDefault(); setIndex(index + (e.shiftKey ? -1 : 1)); }
    e.stopPropagation();
  });
  root.addEventListener('click', (e) => {
    if (!e.target.closest('.quickopen-card')) close();
  });

  return { open, close, isOpen: () => !root.hidden };
}
