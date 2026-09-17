// Dek runtime — runs inside every deck document Dek renders (stage, presenter
// mirror, navigator thumbnails, snapshots). It owns which slide is visible,
// fragments, slide transitions, auto-animate, enter animations, counters,
// charts and the CSS-3D helpers. The shell talks to it through `window.dek`
// (same origin: the document is a srcdoc iframe built by the shell).
//
// Deck authors never load this file; it is injected. Keep it dependency-free
// and free of the literal sequence "</" + "script>".

(function () {
  'use strict';

  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    w: 1920, h: 1080,
    index: 0, step: 0,
    sections: [],
    opts: {},
    zoom: 1,
    listeners: {},
    autoTimer: null,
    transitioning: false,
    ready: false,
    numberEl: null,
  };

  // ---------- helpers ----------

  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const ms = (v, fb) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };

  function cssMs(name, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fb;
    if (v.endsWith('ms')) return parseFloat(v);
    if (v.endsWith('s')) return parseFloat(v) * 1000;
    return ms(v, fb);
  }

  function transitionMs() {
    if (reducedMotion) return 120;
    return S.opts.transitionMs || cssMs('--dek-transition-ms', 480);
  }

  function emit(name, payload) {
    for (const fn of S.listeners[name] || []) {
      try { fn(payload); } catch (e) { console.error('[dek]', e); }
    }
    try { document.dispatchEvent(new CustomEvent('dek:' + name, { detail: payload })); } catch (_) { /* old engines */ }
  }

  function finishAnimations(el) {
    if (!el || !el.getAnimations) return;
    for (const a of el.getAnimations({ subtree: true })) {
      try { a.finish(); } catch (_) { a.cancel(); }
    }
  }
  function cancelAnimations(el) {
    if (!el || !el.getAnimations) return;
    for (const a of el.getAnimations({ subtree: true })) a.cancel();
  }

  // ---------- slides ----------

  function collectSections() {
    // Top-level sections: any <section> without a <section> ancestor. Wrappers
    // (<main>, <div class="deck">) are allowed; nested sections belong to a slide.
    const all = $$('section').filter((el) => !el.parentElement.closest('section'));
    all.forEach((el, i) => {
      el.classList.add('dek-slide');
      el.setAttribute('aria-hidden','true');
      el.inert=true;
      el.dataset.dekIndex = String(i);
      prepareFragments(el);
    });
    return all;
  }

  // Live component instances: <div data-dek-use="name" data-vars='{...}'> is filled
  // from <template data-dek-component="name"> at load, so editing the definition
  // updates every instance. {{var}} placeholders come from data-vars; children
  // with slot="x" replace <slot name="x"> in the template.
  function expandComponents() {
    const defs = new Map();
    for (const t of $$('template[data-dek-component]')) defs.set(t.dataset.dekComponent, t);
    if (!defs.size) return;
    for (const host of $$('[data-dek-use]')) {
      const t = defs.get(host.dataset.dekUse);
      if (!t) { host.textContent = `dek: no component "${host.dataset.dekUse}"`; continue; }
      let vars = {};
      try { vars = JSON.parse(host.dataset.vars || '{}'); } catch (_) { /* keep empty */ }
      const slots = new Map();
      for (const child of Array.from(host.children)) if (child.hasAttribute('slot')) slots.set(child.getAttribute('slot'), child);
      let html = t.innerHTML.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
      const frag = document.createElement('template');
      frag.innerHTML = html;
      for (const slot of Array.from(frag.content.querySelectorAll('slot'))) {
        const fill = slots.get(slot.getAttribute('name'));
        if (fill) slot.replaceWith(...Array.from(fill.childNodes)); else slot.replaceWith(...Array.from(slot.childNodes));
      }
      host.innerHTML = '';
      host.appendChild(frag.content);
      host.classList.add('dek-instance');
    }
  }

  function titleOf(sec) {
    const h = sec.querySelector('h1, h2, h3, h4, h5, h6');
    const text = (h ? h.textContent : (sec.querySelector('p') || sec).textContent) || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function notesOf(sec) {
    const n = sec.querySelector('aside.notes, .notes');
    if (n) {const plain=n.cloneNode(true);for(const br of plain.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));for(const b of plain.querySelectorAll('p,div,li'))b.append(document.createTextNode('\n'));return { html: n.innerHTML.trim(), text: plain.textContent.trim() };}
    const attr = sec.getAttribute('data-speaker-notes'); // Claude Design decks
    if (attr) { const text = attr.replace(/\s+/g, ' ').trim(); const el = document.createElement('div'); el.textContent = text; return { html: el.innerHTML, text }; }
    return { html: '', text: '' };
  }

  // Claude Design's deck-stage gates reveal animations on [data-deck-active];
  // honoring the attribute makes those decks animate the same way in Dek.
  function markActive(sec, on) {
    if (!sec) return;
    if (on) sec.setAttribute('data-deck-active', ''); else sec.removeAttribute('data-deck-active');
  }

  // ---------- fragments ----------

  function prepareFragments(sec) {
    const frags = $$('.fragment', sec).filter((f) => f.closest('section') === sec || !f.closest('section').classList.contains('dek-slide') || f.closest('.dek-slide') === sec);
    let auto = 0;
    const indices = [];
    for (const f of frags) {
      const explicit = f.getAttribute('data-fragment-index');
      const idx = explicit !== null && explicit !== '' ? parseInt(explicit, 10) : auto++;
      f._dekOrder = idx;
      indices.push(idx);
    }
    const steps = Array.from(new Set(indices)).sort((a, b) => a - b);
    for (const f of frags) f._dekRank = steps.indexOf(f._dekOrder);
    sec._dekFrags = frags;
    sec._dekSteps = steps;
  }

  const stepsOf = (i) => (S.sections[i] && S.sections[i]._dekSteps ? S.sections[i]._dekSteps.length : 0);
  const isSkipped = (i) => { const s = S.sections[i]; return !!s && (s.hasAttribute('data-dek-skip') || s.hasAttribute('data-deck-skip')); };
  // next/prev slide that is not skipped (skipped slides stay reachable through go())
  function neighbor(from, dir) {
    for (let i = from + dir; i >= 0 && i < S.sections.length; i += dir) if (S.opts.skipHidden === false || !isSkipped(i)) return i;
    return -1;
  }

  function applyStep(sec, step, instant) {
    if (!sec || !sec._dekFrags) return;
    if (instant) sec.classList.add('dek-instant');
    for (const f of sec._dekFrags) {
      const on = f._dekRank < step;
      f.classList.toggle('visible', on);
      f.classList.toggle('current-fragment', on && f._dekRank === step - 1);
    }
    if (instant) {
      // force style flush so the class change lands without a transition
      void sec.offsetWidth;
      sec.classList.remove('dek-instant');
    }
  }

  // ---------- transitions ----------

  const PRESETS = {
    fade: () => ({
      in: [{ opacity: 0 }, { opacity: 1 }],
      out: [{ opacity: 1 }, { opacity: 0 }],
    }),
    slide: (dir) => ({
      in: [{ transform: `translateX(${dir > 0 ? 100 : -100}%)` }, { transform: 'none' }],
      out: [{ transform: 'none' }, { transform: `translateX(${dir > 0 ? -100 : 100}%)` }],
    }),
    zoom: (dir) => ({
      in: [{ opacity: 0, transform: `scale(${dir > 0 ? 0.92 : 1.08})` }, { opacity: 1, transform: 'none' }],
      out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `scale(${dir > 0 ? 1.08 : 0.92})` }],
    }),
    rise: (dir) => ({
      in: [{ opacity: 0, transform: `translateY(${dir > 0 ? 64 : -64}px)` }, { opacity: 1, transform: 'none' }],
      out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${dir > 0 ? -40 : 40}px)` }],
    }),
    flip: (dir) => ({
      in: [{ opacity: 0, transform: `rotateY(${dir > 0 ? 70 : -70}deg)` }, { opacity: 1, transform: 'none' }],
      out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `rotateY(${dir > 0 ? -70 : 70}deg)` }],
    }),
  };

  function presetFor(to) {
    let name = (to && to.dataset.transition) || S.opts.transition || 'fade';
    if (reducedMotion && name !== 'none') name = 'fade';
    return name;
  }

  function runTransition(from, to, dir, instant) {
    const name = presetFor(to);
    const dur = instant || name === 'none' ? 0 : transitionMs();
    document.body.classList.toggle('dek-flip', name === 'flip');

    if (from && from !== to) {
      from.classList.remove('present');
      from.setAttribute('aria-hidden','true');from.inert=true;
      from.classList.add('dek-leaving');
      markActive(from, false);
      onLeave(from);
    }
    to.classList.add('present');
    to.removeAttribute('aria-hidden');to.inert=false;
    to.classList.remove('dek-leaving');
    if (!isStatic()) markActive(to, true);

    const finishLeave = () => {
      if (!from || from === to) return;
      cancelAnimations(from);
      from.classList.remove('dek-leaving');
    };

    if (dur === 0 || !to.animate) {
      finishLeave();
      afterEnter(to, true);
      return;
    }

    if (from && from !== to && from.hasAttribute('data-auto-animate') && to.hasAttribute('data-auto-animate')) {
      autoAnimate(from, to, dir, finishLeave);
      afterEnter(to, false, true);
      return;
    }

    const kf = PRESETS[name] ? PRESETS[name](dir) : PRESETS.fade(dir);
    S.transitioning = true;
    const anim = to.animate(kf.in, { duration: dur, easing: EASE, fill: 'backwards' });
    if (from && from !== to) {
      const out = from.animate(kf.out, { duration: dur, easing: EASE, fill: 'forwards' });
      out.onfinish = finishLeave;
      out.oncancel = finishLeave;
    }
    anim.onfinish = () => { S.transitioning = false; };
    afterEnter(to, false);
  }

  // ---------- auto-animate (FLIP between slides sharing data-id elements) ----------

  function autoAnimate(from, to, dir, done) {
    const dur = reducedMotion ? 120 : (S.opts.autoAnimateMs || ms(to.dataset.autoAnimateDuration, 600));
    const z = S.zoom || 1;
    const fromMap = new Map();
    for (const el of $$('[data-id]', from)) fromMap.set(el.dataset.id, el);

    const pairs = [];
    for (const el of $$('[data-id]', to)) {
      const src = fromMap.get(el.dataset.id);
      if (!src) continue;
      // nested matches would compound transforms; only animate the outermost match
      const outer = el.parentElement && el.parentElement.closest('[data-id]');
      if (outer && outer !== to && fromMap.has(outer.dataset.id) && to.contains(outer)) continue;
      pairs.push([src, el]);
    }

    for (const [src, el] of pairs) {
      const a = src.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!a.width || !b.width) continue;
      const fs = getComputedStyle(src);
      const ts = getComputedStyle(el);
      const dx = (a.left - b.left) / z;
      const dy = (a.top - b.top) / z;
      const isText = !el.children.length && el.textContent.trim().length > 0;
      const k0 = {
        transformOrigin: '0 0',
        transform: `translate(${dx}px, ${dy}px)`,
        opacity: fs.opacity,
        color: fs.color,
        backgroundColor: fs.backgroundColor,
        borderRadius: fs.borderRadius,
      };
      const k1 = {
        transformOrigin: '0 0',
        transform: 'none',
        opacity: ts.opacity,
        color: ts.color,
        backgroundColor: ts.backgroundColor,
        borderRadius: ts.borderRadius,
      };
      if (isText) {
        k0.fontSize = fs.fontSize; k1.fontSize = ts.fontSize;
        k0.letterSpacing = fs.letterSpacing; k1.letterSpacing = ts.letterSpacing;
        const sx = a.width / b.width;
        if (Math.abs(sx - 1) > 0.02 && Math.abs(parseFloat(fs.fontSize) - parseFloat(ts.fontSize)) < 0.5) {
          k0.transform += ` scale(${sx}, ${a.height / b.height})`;
        }
      } else {
        k0.transform += ` scale(${a.width / b.width}, ${a.height / b.height})`;
      }
      el.animate([k0, k1], { duration: dur, easing: EASE, fill: 'backwards' });
      // the source copy disappears at once; the incoming copy carries the motion
      src.animate([{ opacity: 0 }, { opacity: 0 }], { duration: dur, fill: 'both' });
    }

    // unmatched incoming elements settle in a beat later
    const matched = new Set(pairs.map((p) => p[1]));
    for (const el of Array.from(to.children)) {
      if (el.matches('aside.notes, .notes, script, style')) continue;
      if (matched.has(el) || Array.from(matched).some((m) => el.contains(m))) continue;
      el.animate(
        [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
        { duration: dur * 0.7, delay: dur * 0.25, easing: EASE, fill: 'backwards' }
      );
    }

    S.transitioning = true;
    const out = from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.55, easing: EASE, fill: 'forwards' });
    out.onfinish = () => { S.transitioning = false; done(); };
    out.oncancel = () => { S.transitioning = false; done(); };
  }

  // ---------- enter / leave hooks ----------

  const ENTER = {
    'fade': [{ opacity: 0 }, { opacity: 1 }],
    'fade-up': [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }],
    'fade-down': [{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'none' }],
    'fade-left': [{ opacity: 0, transform: 'translateX(56px)' }, { opacity: 1, transform: 'none' }],
    'fade-right': [{ opacity: 0, transform: 'translateX(-56px)' }, { opacity: 1, transform: 'none' }],
    'rise': [{ opacity: 0, transform: 'translateY(90px)' }, { opacity: 1, transform: 'none' }],
    'zoom-in': [{ opacity: 0, transform: 'scale(0.84)' }, { opacity: 1, transform: 'none' }],
    'zoom-out': [{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'none' }],
    'blur-in': [{ opacity: 0, filter: 'blur(18px)' }, { opacity: 1, filter: 'blur(0px)' }],
    'wipe-right': [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
    'wipe-up': [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
    'grow-x': [{ transform: 'scaleX(0)', transformOrigin: '0 50%' }, { transform: 'scaleX(1)', transformOrigin: '0 50%' }],
    'grow-y': [{ transform: 'scaleY(0)', transformOrigin: '50% 100%' }, { transform: 'scaleY(1)', transformOrigin: '50% 100%' }],
  };

  const isStatic = () => !!(S.opts.static || S.editing);

  function runEnterAnimations(sec, skipLead) {
    if (isStatic() || !sec.animate) return;
    const lead = skipLead ? 0 : Math.min(transitionMs() * 0.35, 220);
    for (const el of $$('[data-animate]', sec)) {
      const name = el.dataset.animate || 'fade-up';
      const kf = ENTER[name] || ENTER['fade-up'];
      const duration = reducedMotion ? 150 : ms(el.dataset.duration, 700);
      const baseDelay = lead + ms(el.dataset.delay, 0);
      const stagger = el.dataset.stagger;
      if (stagger !== undefined) {
        const step = reducedMotion ? 0 : ms(stagger, 80);
        Array.from(el.children).forEach((child, i) => {
          child.animate(kf, { duration, delay: baseDelay + i * step, easing: EASE, fill: 'backwards' });
        });
      } else {
        el.animate(kf, { duration, delay: baseDelay, easing: EASE, fill: 'backwards' });
      }
    }
  }

  function runCounters(sec) {
    for (const el of $$('[data-count-to]', sec)) {
      const to = parseFloat(el.dataset.countTo);
      if (!Number.isFinite(to)) continue;
      const from = ms(el.dataset.countFrom, 0);
      const decimals = el.dataset.decimals !== undefined ? parseInt(el.dataset.decimals, 10) : ((String(el.dataset.countTo).split('.')[1] || '').length);
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      const fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const render = (v) => { el.textContent = prefix + fmt.format(v) + suffix; };
      if (isStatic() || reducedMotion) { render(to); continue; }
      const duration = ms(el.dataset.duration, 1400);
      const delay = ms(el.dataset.delay, 0);
      const t0 = performance.now() + delay;
      render(from);
      if (el._dekRaf) cancelAnimationFrame(el._dekRaf);
      const tick = (now) => {
        const p = clamp((now - t0) / duration, 0, 1);
        const e = 1 - Math.pow(1 - p, 4);
        render(from + (to - from) * e);
        if (p < 1) el._dekRaf = requestAnimationFrame(tick);
      };
      el._dekRaf = requestAnimationFrame(tick);
    }
  }

  function runTypewriters(sec) {
    for (const el of $$('[data-typewriter]', sec)) {
      if (el._dekFull === undefined) el._dekFull = el.textContent;
      const full = el._dekFull;
      if (isStatic() || reducedMotion) { el.textContent = full; continue; }
      const speed = ms(el.dataset.typewriter, 28);
      const delay = ms(el.dataset.delay, 0);
      el.textContent = '';
      clearInterval(el._dekTimer);
      let i = 0;
      setTimeout(() => {
        el._dekTimer = setInterval(() => {
          i++;
          el.textContent = full.slice(0, i);
          if (i >= full.length) clearInterval(el._dekTimer);
        }, speed);
      }, delay);
    }
  }

  function afterEnter(sec, instant, skipLead) {
    if (!instant) {
      runEnterAnimations(sec, skipLead);
    }
    runCounters(sec);
    runTypewriters(sec);
    for (const fig of $$('.dek-chart', sec)) animateChart(fig, instant);
    scheduleAutoslide(sec);
    updateNumber();
  }

  function onLeave(sec) {
    for (const el of $$('[data-count-to]', sec)) if (el._dekRaf) cancelAnimationFrame(el._dekRaf);
    for (const el of $$('[data-typewriter]', sec)) clearInterval(el._dekTimer);
    clearTimeout(S.autoTimer);
  }

  function scheduleAutoslide(sec) {
    clearTimeout(S.autoTimer);
    if (!S.opts.autoslide || isStatic()) return;
    const wait = ms(sec.dataset.autoslide, S.opts.autoslideMs || 0);
    if (wait > 0) S.autoTimer = setTimeout(() => api.next() || emit('end'), wait);
  }

  // ---------- charts ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(name, attrs, parent) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * p;
  }
  function fmtNum(v, o) {
    const opts = o.compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: o.decimals !== undefined ? o.decimals : 1 };
    return (o.prefix || '') + new Intl.NumberFormat(undefined, opts).format(v) + (o.suffix || '');
  }

  // Deck-wide chart preferences (the design system writes them into <meta name="dek-chart">);
  // anything a figure sets in its own data-chart options still wins.
  let chartDefaults = null;
  function deckChartDefaults() {
    if (chartDefaults) return chartDefaults;
    const meta = document.querySelector('meta[name="dek-chart"]');
    try { chartDefaults = meta ? JSON.parse(meta.content || '{}') : {}; } catch (e) { chartDefaults = {}; }
    if (!chartDefaults || typeof chartDefaults !== 'object') chartDefaults = {};
    return chartDefaults;
  }

  function renderChart(fig) {
    let spec;
    try { spec = JSON.parse(fig.dataset.chart || '{}'); } catch (e) {
      fig.textContent = 'dek-chart: invalid JSON in data-chart';
      return;
    }
    const type = spec.type || 'bar';
    const o = Object.assign({}, deckChartDefaults(), spec.options || {});
    const labels = spec.labels || [];
    let series = spec.series || (spec.data ? [{ name: spec.name || '', data: spec.data }] : []);
    series = series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, data: (s.data || []).map(Number), color: (o.colors || [])[i] || s.color }));
    fig._dekType = type;

    const rect = fig.getBoundingClientRect();
    const z = S.zoom || 1;
    const W = Math.round(rect.width / z) || 1200;
    const H = Math.round(rect.height / z) || Math.round(W * 0.5);
    fig.innerHTML = '';
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img' }, fig);
    if (o.title) root.setAttribute('aria-label', o.title);

    const legend = o.legend !== undefined ? o.legend : series.length > 1;
    let top = o.title ? 56 : 16;
    if (o.title) {
      const t = svg('text', { x: 0, y: 34, class: 'dek-legend' }, root);
      t.style.fontWeight = '600';
      t.textContent = o.title;
    }

    if (legend && type !== 'donut' && type !== 'pie') {
      const g = svg('g', { class: 'dek-legend' }, root);
      let x = 0;
      const y = top + 14;
      series.forEach((s, i) => {
        const item = svg('g', { class: `dek-series-${(i % 6) + 1}`, transform: `translate(${x}, ${y})` }, g);
        if (s.color) item.style.setProperty('--c', s.color);
        svg('rect', { x: 0, y: -12, width: 20, height: 20, style: 'fill: var(--c)' }, item);
        const t = svg('text', { x: 30, y: 6 }, item);
        t.textContent = s.name;
        x += 30 + s.name.length * 13 + 44;
      });
      top += 48;
    }

    if (type === 'donut' || type === 'pie') return renderDonut(root, W, H, top, labels, series, o);
    return renderXY(root, W, H, top, type, labels, series, o);
  }

  function renderXY(root, W, H, top, type, labels, series, o) {
    const pl = o.yLabels === false ? 24 : 96;
    const pr = 24;
    const pb = 64;
    const pw = W - pl - pr;
    const ph = H - top - pb;
    const n = Math.max(labels.length, ...series.map((s) => s.data.length));
    const stacked = !!o.stacked && type === 'bar';
    let maxV = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) maxV = Math.max(maxV, series.reduce((a, s) => a + (s.data[i] || 0), 0));
      else for (const s of series) maxV = Math.max(maxV, s.data[i] || 0);
    }
    const ymax = o.ymax || niceMax(maxV);
    const ymin = o.ymin || 0;
    const yOf = (v) => top + ph - ((v - ymin) / (ymax - ymin)) * ph;

    // grid + y ticks
    const ticks = o.ticks || 4;
    const grid = svg('g', { class: 'dek-grid' }, root);
    for (let i = 0; i <= ticks; i++) {
      const v = ymin + ((ymax - ymin) * i) / ticks;
      const y = yOf(v);
      if (o.grid !== false || i === 0) svg('line', { x1: pl, x2: pl + pw, y1: y, y2: y, class: i === 0 ? 'dek-axis' : '' }, i === 0 ? svg('g', { class: 'dek-axis' }, root) : grid);
      if (o.yLabels !== false) {
        const t = svg('text', { x: pl - 16, y: y + 8, 'text-anchor': 'end', class: 'dek-tick' }, root);
        t.textContent = fmtNum(v, o);
      }
    }

    const slot = pw / Math.max(n, 1);
    const xCenter = (i) => pl + slot * i + slot / 2;

    // x labels
    labels.forEach((lab, i) => {
      const t = svg('text', { x: xCenter(i), y: top + ph + 40, 'text-anchor': 'middle', class: 'dek-tick' }, root);
      t.textContent = lab;
    });

    if (type === 'bar') {
      const inner = slot * (o.barWidth || 0.68);
      const bw = stacked ? inner : inner / series.length;
      const acc = new Array(n).fill(0);
      series.forEach((s, si) => {
        const g = svg('g', { class: `dek-series-${(si % 6) + 1}` }, root);
        if (s.color) g.style.setProperty('--c', s.color);
        for (let i = 0; i < n; i++) {
          const v = s.data[i] || 0;
          const x = stacked ? xCenter(i) - inner / 2 : xCenter(i) - inner / 2 + bw * si;
          const y0 = stacked ? acc[i] : 0;
          const y = yOf(y0 + v);
          const h = Math.max(0, yOf(y0) - y);
          const r = svg('rect', { x: x + 2, y, width: Math.max(1, bw - 4), height: h, rx: Math.min(o.radius !== undefined ? o.radius : 6, bw / 2), class: 'dek-bar' }, g);
          r.dataset.order = String(i * series.length + si);
          if (o.values && !stacked) {
            const t = svg('text', { x: x + bw / 2, y: y - 12, 'text-anchor': 'middle', class: 'dek-value' }, g);
            t.textContent = fmtNum(v, o);
          }
          acc[i] = y0 + v;
        }
      });
    } else {
      // line / area
      series.forEach((s, si) => {
        const g = svg('g', { class: `dek-series-${(si % 6) + 1}` }, root);
        if (s.color) g.style.setProperty('--c', s.color);
        const pts = s.data.map((v, i) => [xCenter(i), yOf(v)]);
        if (!pts.length) return;
        let d = '';
        if (o.smooth) {
          d = `M ${pts[0][0]} ${pts[0][1]}`;
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1];
            const [x1, y1] = pts[i];
            const cx = (x0 + x1) / 2;
            d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
          }
        } else {
          d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
        }
        if (type === 'area') {
          svg('path', { d: `${d} L ${pts[pts.length - 1][0]} ${yOf(ymin)} L ${pts[0][0]} ${yOf(ymin)} Z`, class: 'dek-area' }, g);
        }
        svg('path', { d, class: 'dek-line' }, g);
        if (o.dots !== false) {
          pts.forEach((p, i) => {
            svg('circle', { cx: p[0], cy: p[1], r: o.dotRadius || 9, class: 'dek-dot' }, g);
            if (o.values) {
              const t = svg('text', { x: p[0], y: p[1] - 22, 'text-anchor': 'middle', class: 'dek-value' }, g);
              t.textContent = fmtNum(s.data[i], o);
            }
          });
        }
      });
    }
  }

  function renderDonut(root, W, H, top, labels, series, o) {
    const data = (series[0] ? series[0].data : []).map((v) => Math.max(0, v));
    const total = data.reduce((a, b) => a + b, 0) || 1;
    const legendW = o.legend === false ? 0 : Math.min(W * 0.42, 520);
    const cx = (W - legendW) / 2;
    const cy = top + (H - top) / 2;
    const R = Math.min(W - legendW, H - top) / 2 - 20;
    const thick = o.type === 'pie' || o.pie ? R : (o.thickness || R * 0.36);
    const r = R - thick / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    data.forEach((v, i) => {
      const len = (v / total) * circ;
      const gap = data.length > 1 ? Math.min(10, circ * 0.006) : 0;
      const g = svg('g', { class: `dek-series-${(i % 6) + 1}` }, root);
      const color = (o.colors || [])[i];
      if (color) g.style.setProperty('--c', color);
      const c = svg('circle', {
        cx, cy, r, class: 'dek-arc',
        'stroke-width': thick,
        'stroke-dasharray': `${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
      }, g);
      c.dataset.len = String(Math.max(0, len - gap));
      c.dataset.circ = String(circ);
      c.dataset.order = String(i);
      offset += len;
    });
    const center = o.center !== undefined ? o.center : fmtNum(total, o);
    const t = svg('text', { x: cx, y: cy + (o.centerSub ? -2 : 10), 'text-anchor': 'middle', class: 'dek-donut-label' }, root);
    t.textContent = center;
    if (o.centerSub) {
      const s = svg('text', { x: cx, y: cy + 32, 'text-anchor': 'middle', class: 'dek-donut-sub' }, root);
      s.textContent = o.centerSub;
    }
    if (legendW) {
      const g = svg('g', { class: 'dek-legend' }, root);
      const x = W - legendW + 24;
      const rowH = Math.min(56, (H - top) / Math.max(1, data.length));
      const y0 = cy - (rowH * data.length) / 2 + rowH / 2;
      data.forEach((v, i) => {
        const item = svg('g', { class: `dek-series-${(i % 6) + 1}`, transform: `translate(${x}, ${y0 + rowH * i})` }, g);
        const color = (o.colors || [])[i];
        if (color) item.style.setProperty('--c', color);
        svg('rect', { x: 0, y: -12, width: 20, height: 20, style: 'fill: var(--c)' }, item);
        const lab = svg('text', { x: 32, y: 7 }, item);
        lab.textContent = labels[i] !== undefined ? labels[i] : `#${i + 1}`;
        const val = svg('text', { x: 32, y: 7, class: 'dek-value' }, item);
        val.textContent = o.percent === false ? fmtNum(v, o) : Math.round((v / total) * 100) + '%';
        // place the value after the measured label; fall back to an estimate when not rendered yet
        let labW = 0;
        try { labW = lab.getComputedTextLength(); } catch (_) { /* detached */ }
        if (!labW) labW = String(lab.textContent).length * 12.5;
        val.setAttribute('x', 32 + labW + 20);
      });
    }
  }

  function animateChart(fig, instant) {
    if (!fig._dekType) renderChart(fig);
    if (isStatic() || instant || reducedMotion || !fig.animate) return;
    const dur = ms(fig.dataset.duration, 1100);
    const delay = ms(fig.dataset.delay, 120);
    const type = fig._dekType;
    if (type === 'bar') {
      for (const r of $$('.dek-bar', fig)) {
        r.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: dur, delay: delay + Number(r.dataset.order || 0) * 45, easing: EASE, fill: 'backwards' });
      }
      for (const t of $$('.dek-value', fig)) t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: delay + dur * 0.7, fill: 'backwards' });
    } else if (type === 'donut' || type === 'pie') {
      for (const c of $$('.dek-arc', fig)) {
        const len = Number(c.dataset.len), circ = Number(c.dataset.circ);
        c.animate([{ strokeDasharray: `0 ${circ}` }, { strokeDasharray: `${len} ${circ - len}` }], { duration: dur, delay: delay + Number(c.dataset.order || 0) * 90, easing: EASE, fill: 'backwards' });
      }
      for (const t of $$('.dek-donut-label, .dek-donut-sub, .dek-legend', fig)) t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: delay + dur * 0.5, fill: 'backwards' });
    } else {
      for (const p of $$('.dek-line', fig)) {
        let L = 2000;
        try { L = p.getTotalLength(); } catch (_) { /* not rendered yet */ }
        p.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], { duration: dur, delay, easing: EASE, fill: 'backwards' });
      }
      for (const a of $$('.dek-area', fig)) a.animate([{ opacity: 0 }, { opacity: 0.16 }], { duration: dur, delay: delay + dur * 0.3, easing: EASE, fill: 'backwards' });
      $$('.dek-dot, .dek-value', fig).forEach((d, i) => d.animate([{ opacity: 0, transform: 'scale(0.4)', transformOrigin: 'center', transformBox: 'fill-box' }, { opacity: 1, transform: 'scale(1)', transformOrigin: 'center', transformBox: 'fill-box' }], { duration: 400, delay: delay + (i / Math.max(1, $$('.dek-dot', fig).length)) * dur, easing: EASE, fill: 'backwards' }));
    }
  }

  // ---------- 3D tilt ----------

  let tiltRaf = 0;
  function onMouseMove(e) {
    if (isStatic()) return;
    const sec = S.sections[S.index];
    if (!sec) return;
    const els = $$('.dek-tilt', sec);
    if (!els.length) return;
    cancelAnimationFrame(tiltRaf);
    tiltRaf = requestAnimationFrame(() => {
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const px = clamp((e.clientX - r.left) / r.width, 0, 1);
        const py = clamp((e.clientY - r.top) / r.height, 0, 1);
        const max = ms(el.dataset.tilt, 10);
        el.style.transform = `rotateX(${(0.5 - py) * max * 2}deg) rotateY(${(px - 0.5) * max * 2}deg)`;
      }
    });
  }
  function resetTilt(sec) {
    for (const el of $$('.dek-tilt', sec)) el.style.transform = '';
  }

  // ---------- fit ----------

  function fit() {
    const vw = innerWidth || document.documentElement.clientWidth;
    const vh = innerHeight || document.documentElement.clientHeight;
    if (!vw || !vh) return;
    const z = Math.min(vw / S.w, vh / S.h) || 1;
    S.zoom = z;
    const b = document.body;
    // A transform, not CSS zoom: WebKit resolves ch/ex units against the zoomed
    // font under `zoom`, which shrinks every `max-width: 42ch` with the window.
    // Transforms leave layout units alone; the canvas is always 1920×1080.
    const dx = Math.max(0, (vw - S.w * z) / 2);
    const dy = Math.max(0, (vh - S.h * z) / 2);
    b.style.transformOrigin = '0 0';
    b.style.transform = z === 1 ? 'none' : `scale(${z})`;
    b.style.left = dx + 'px';
    b.style.top = dy + 'px';
    emit('resize', { zoom: z });
    if (EDIT.sel) refreshSel();
  }

  function updateNumber() {
    if (!S.numberEl) return;
    S.numberEl.textContent = S.opts.slideNumberFormat === 'of'
      ? `${S.index + 1} / ${S.sections.length}`
      : String(S.index + 1);
  }


  // ---------- editing: direct manipulation on the stage ----------
  // The shell turns this on. Units are selected by click, moved by drag
  // (CSS `translate`, so layouts stay intact), resized by a corner handle and
  // edited in place (contenteditable). Every change is reported to the shell
  // as an 'edit' event with the element's child-index path from the slide, and
  // the shell writes the same change into the file. The live DOM stays as the
  // source of what the user sees; no reload happens.

  const EDIT = { on: false, sel: null, box: null, hover: null, drag: null, resize: null, textEl: null, textBackup: '', textSaved: '', range: null, keepText: false, textTimer: null, multi: [], snap: true };
  const ATOMIC_SEL = '.dek-shape,.dek-instance,[data-dek-use],.dek-chart,.dek-cube,.dek-scene,figure,table,pre,video,canvas,iframe,svg,img,.dek-atomic';
  const TEXT_SEL = 'h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,li,.dek-text';
  const TEXT_TAGS = /^(H[1-6]|P|BLOCKQUOTE|UL|OL|LI|DIV|SPAN|FIGCAPTION|SMALL|LABEL|DT|DD)$/;

  function currentSection() { return S.sections[S.index]; }

  function unitFor(target) {
    const sec = currentSection();
    if (!sec || !target || target === sec || !sec.contains(target)) return null;
    if (target.closest('.dek-sel, .dek-hover')) return null;
    let n = target, atomic = null;
    while (n && n !== sec) { if (n.matches(ATOMIC_SEL)) atomic = n; n = n.parentElement; }
    if (atomic) return atomic;
    const t = target.closest(TEXT_SEL);
    if (t && t !== sec && sec.contains(t)) return t.tagName === 'LI' ? (t.closest('ul,ol') || t) : t;
    n = target;
    while (n.parentElement && n.parentElement !== sec) n = n.parentElement;
    return n === sec || n.matches('.dek-sel,.dek-hover') ? null : n;
  }

  function pathOf(el) {
    const sec = currentSection();
    const path = [];
    let n = el;
    while (n && n !== sec) {
      const p = n.parentElement;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    return n === sec ? path : null;
  }
  function elAt(path) {
    let n = currentSection();
    for (const i of path || []) n = n && n.children[i];
    return n || null;
  }

  function kindOf(el) {
    if (!el) return 'block';
    if(el.matches('.dek-group')) return 'group';
    if (el.matches('.dek-shape,[data-shape]')) return 'shape';
    if (el.matches('.dek-instance,[data-dek-use]')) return 'component';
    if (el.matches('img,video,canvas,svg,iframe') || (el.tagName === 'FIGURE' && el.querySelector('img,video'))) return 'image';
    if (el.matches('.dek-chart')) return 'chart';
    if (el.matches('.dek-cube,.dek-scene')) return '3d';
    if (el.matches(TEXT_SEL) || (TEXT_TAGS.test(el.tagName) && !el.children.length)) return 'text';
    return 'block';
  }

  function slideRect(el) {
    const sec = currentSection();
    const a = sec.getBoundingClientRect(), b = el.getBoundingClientRect(), z = S.zoom || 1;
    return { x: (b.left - a.left) / z, y: (b.top - a.top) / z, w: b.width / z, h: b.height / z };
  }
  function layoutRect(el, parent=currentSection()) {
    const r=slideRect(el),p=parent===currentSection()?{x:0,y:0}:slideRect(parent),cs=getComputedStyle(el);
    const w=el.offsetWidth,h=el.offsetHeight;
    return {x:r.x-p.x+(r.w-w)/2,y:r.y-p.y+(r.h-h)/2,w,h,rotate:parseFloat(cs.rotate)||0};
  }

  function ensureBoxes() {
    const sec = currentSection();
    if (!sec) return;
    if (!EDIT.box) {
      EDIT.box = document.createElement('div');
      EDIT.box.className = 'dek-sel';
      EDIT.box.innerHTML = '<div class="dek-sel-label"></div><div class="dek-sel-handle"></div>';
      EDIT.hover = document.createElement('div');
      EDIT.hover.className = 'dek-hover';
      EDIT.box.querySelector('.dek-sel-handle').addEventListener('mousedown', startResize);
    }
    if (EDIT.box.parentElement !== sec) { sec.appendChild(EDIT.hover); sec.appendChild(EDIT.box); }
  }
  function positionBox(box, el) {
    const r = slideRect(el);
    box.style.left = r.x + 'px';
    box.style.top = r.y + 'px';
    box.style.width = r.w + 'px';
    box.style.height = r.h + 'px';
  }
  function labelFor(el) {
    if (el.dataset.shape) return el.dataset.shape;
    if (el.dataset.dekUse) return el.dataset.dekUse;
    if (el.classList.contains('dek-chart')) return 'chart';
    if (el.classList.contains('dek-instance')) return 'component';
    const t = el.tagName.toLowerCase();
    if (t === 'p') return 'text';
    return t;
  }
  function refreshSel() {
    if (!EDIT.sel || !EDIT.box) return;
    if (!EDIT.sel.isConnected) { select(null); return; }
    ensureBoxes();
    positionBox(EDIT.box, EDIT.sel);
    EDIT.box.querySelector('.dek-sel-label').textContent = EDIT.multi.length>1 ? `${EDIT.multi.length} selected` : labelFor(EDIT.sel)+(EDIT.sel.hasAttribute('data-dek-locked')?' · locked':'');
    for(const n of document.querySelectorAll('[data-dek-selected]'))n.removeAttribute('data-dek-selected');
    EDIT.multi.filter(n=>n!==EDIT.sel).forEach(n=>n.setAttribute('data-dek-selected',''));
    EDIT.box.style.display = 'block';
  }
  function selInfo() {
    const el = EDIT.sel;
    if (!el || !el.isConnected) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const anchor=EDIT.range?.startContainer;
    const tc=EDIT.textEl && anchor && EDIT.textEl.contains(anchor)?getComputedStyle(anchor.nodeType===1?anchor:anchor.parentElement):cs;
    return {
      id:el.dataset.dekId || null, paths:EDIT.multi.filter(n=>n.isConnected).map(pathOf), count:EDIT.multi.length, locked:el.hasAttribute('data-dek-locked'), aspect:el.dataset.dekAspect!=='free', objectPosition:cs.objectPosition, link:el.querySelector('a')?.getAttribute('href') || '', path: pathOf(el), tag: el.tagName.toLowerCase(), kind: kindOf(el), label: labelFor(el),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      textAlign: cs.textAlign, fontSizeRem: Math.round((parseFloat(cs.fontSize) / 32) * 100) / 100,
      translate: el.style.translate || '', editingText: EDIT.textEl === el,
      src: el.tagName === 'IMG' ? el.getAttribute('src') : undefined,
      geometry: slideRect(el), width: parseFloat(cs.width) || el.offsetWidth, height: parseFloat(cs.height) || el.offsetHeight,
      fontFamily: tc.fontFamily, fontSize: parseFloat(tc.fontSize), fontWeight: tc.fontWeight,
      fontStyle: tc.fontStyle, color: tc.color, backgroundColor: tc.backgroundColor,
      textDecoration: cs.textDecorationLine, textTransform: cs.textTransform,
      lineHeight: cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
      letterSpacing: parseFloat(cs.letterSpacing) || 0, opacity: parseFloat(cs.opacity),
      borderColor: cs.borderTopColor, borderWidth: parseFloat(cs.borderTopWidth), borderRadius: parseFloat(cs.borderTopLeftRadius),
      rotate: parseFloat(cs.rotate) || 0, alt: el.getAttribute('alt') || '', objectFit: cs.objectFit,
    };
  }
  function select(el, additive=false) {
    EDIT.keepText = false; EDIT.range = null;
    if (EDIT.textEl && EDIT.textEl !== el) commitText();
    if(additive && el) { EDIT.multi=EDIT.multi.includes(el)?EDIT.multi.filter(n=>n!==el):[...EDIT.multi,el]; } else EDIT.multi=el?[el]:[];
    EDIT.sel = EDIT.multi[EDIT.multi.length-1] || null;
    el=EDIT.sel;
    ensureBoxes();
    if (EDIT.hover) EDIT.hover.style.display = 'none';
    if (!el) { for(const n of document.querySelectorAll('[data-dek-selected]'))n.removeAttribute('data-dek-selected'); if (EDIT.box) EDIT.box.style.display = 'none'; emit('edit', { type: 'select', info: null }); return; }
    refreshSel();
    emit('edit', { type: 'select', info: selInfo() });
  }

  function parseTranslate(el) {
    // engines serialize `translate: 40px 0px` as `translate: 40px`
    const parts = (el.style.translate || '').trim().split(/\s+/).map(parseFloat);
    return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
  }
  function setTranslate(el, x, y) {
    el.style.translate = (Math.round(x) === 0 && Math.round(y) === 0) ? '' : `${Math.round(x)}px ${Math.round(y)}px`;
  }

  function onEditMouseDown(e) {
    if (!EDIT.on || e.button !== 0) return;
    if (e.target.closest('.dek-sel-handle')) return;
    if (EDIT.textEl && EDIT.textEl.contains(e.target)) return;
    const unit = unitFor(e.target);
    if (!unit) { if (EDIT.textEl) commitText(); select(null); return; }
    e.preventDefault();
    if(e.shiftKey || e.metaKey) { select(unit,true); return; }
    if(!EDIT.multi.includes(unit))select(unit);
    if(EDIT.multi.some(n=>n.hasAttribute('data-dek-locked')))return;
    const [tx, ty] = parseTranslate(unit);
    EDIT.drag = { el: unit, x0: e.clientX, y0: e.clientY, tx, ty, moved: false, elements:EDIT.multi.map(el=>({el,xy:parseTranslate(el)})) };

  }
  function onEditMouseMove(e) {
    if (!EDIT.on) return;
    if (EDIT.drag) {
      const z = S.zoom || 1;
      const dx = (e.clientX - EDIT.drag.x0) / z, dy = (e.clientY - EDIT.drag.y0) / z;
      if (!EDIT.drag.moved && Math.hypot(dx * z, dy * z) < 3) return;
      EDIT.drag.moved = true;
      for(const it of EDIT.drag.elements) { const x=it.xy[0]+dx,y=it.xy[1]+dy; setTranslate(it.el,EDIT.snap && !e.altKey?Math.round(x/8)*8:x,EDIT.snap && !e.altKey?Math.round(y/8)*8:y); }
      refreshSel();
      return;
    }
    if (EDIT.textEl || EDIT.resize) return;
    const unit = unitFor(e.target);
    if (unit && unit !== EDIT.sel) { ensureBoxes(); positionBox(EDIT.hover, unit); EDIT.hover.style.display = 'block'; }
    else if (EDIT.hover) EDIT.hover.style.display = 'none';
  }
  function onEditMouseUp() {
    if (!EDIT.drag) return;
    const d = EDIT.drag;
    EDIT.drag = null;
    if (d.moved) emitStyles(d.elements.map(it=>({el:it.el,style:{translate:it.el.style.translate || null}})),'move elements');
  }
  function onEditDblClick(e) {
    if (!EDIT.on) return;
    const unit = unitFor(e.target);
    if (!unit) return;
    if (kindOf(unit) === 'text') { select(unit); startText(e); }
  }
  function onEditMouseLeave() { if (EDIT.hover) EDIT.hover.style.display = 'none'; }

  function startResize(e) {
    const el = EDIT.sel;
    if (!el || el.hasAttribute('data-dek-locked')) return;
    if(EDIT.textEl)commitText();
    e.preventDefault();
    e.stopPropagation();
    const r = slideRect(el);
    const both = el.matches('.dek-chart,.dek-scene,.dek-cube,div:not(.dek-text):not(.dek-instance):not([data-dek-use])');
    EDIT.resize = { el, x0: e.clientX, y0: e.clientY, w0: el.offsetWidth || r.w, h0: el.offsetHeight || r.h, group:groupGeometry(el) };
    const move = (ev) => {
      const z = S.zoom || 1;
      const w = Math.max(24, EDIT.resize.w0 + (ev.clientX - EDIT.resize.x0) / z);
      el.style.width = Math.round(w) + 'px';
      if (both) el.style.height = Math.round(Math.max(24, EDIT.resize.h0 + (ev.clientY - EDIT.resize.y0) / z)) + 'px';
      else if (el.matches('img,video,canvas,svg,iframe')) el.style.height = Math.round(el.dataset.dekAspect==='free' || ev.shiftKey ? Math.max(24,EDIT.resize.h0+(ev.clientY-EDIT.resize.y0)/z) : w*EDIT.resize.h0/EDIT.resize.w0)+'px';
      EDIT.resize.updates=scaleGroup(EDIT.resize.group,parseFloat(el.style.width)/EDIT.resize.w0,parseFloat(el.style.height)/EDIT.resize.h0);
      refreshSel();
    };
    const up = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      const updates=EDIT.resize.updates || [];EDIT.resize = null;
      emitStyles([{el,style:{width:el.style.width,height:el.style.height || null}},...updates],'resize group');
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
  }

  function startText(e, opts) {
    const el = EDIT.sel;
    if(el?.hasAttribute('data-dek-locked'))return;
    if (!el || EDIT.textEl === el) return;
    if (EDIT.textEl) commitText();
    EDIT.textEl = el;
    EDIT.textBackup = el.innerHTML;
    EDIT.textSaved = cleanHtml(el.innerHTML);
    EDIT.textTransaction = 'typing-'+crypto.randomUUID();
    EDIT.keepText = false; EDIT.range = null;
    el.setAttribute('contenteditable', 'true');
    el.classList.add('dek-editing-text');
    el.setAttribute('spellcheck', 'false');
    el.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    if (opts && opts.selectAll) {
      const range = document.createRange(); range.selectNodeContents(el); sel.addRange(range);
    } else if (e && document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY)) {
      sel.addRange(document.caretRangeFromPoint(e.clientX, e.clientY));
    } else {
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); sel.addRange(range);
    }
    el.addEventListener('input', onTextInput);
    el.addEventListener('paste', onTextPaste);
    el.addEventListener('keydown', onTextKey);
    el.addEventListener('blur', onTextBlur);
    emit('edit', { type: 'select', info: selInfo() });
  }
  function onTextKey(e) {
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { e.preventDefault(); cancelText(); return; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); commitText(); return; }
    if (mod && k === 'b') { e.preventDefault(); document.execCommand('bold'); }
    if (mod && k === 'i') { e.preventDefault(); document.execCommand('italic'); }
  }
  function onTextBlur() { if (EDIT.textEl && !EDIT.keepText) commitText(); }
  function onTextInput() {
    refreshSel(); clearTimeout(EDIT.textTimer); EDIT.textTimer = setTimeout(flushText, 500);
  }
  function onTextPaste(e) {
    // Text from websites should not bring invisible formatting or active markup into a slide.
    e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }
  function flushText() {
    clearTimeout(EDIT.textTimer);
    const el = EDIT.textEl; if (!el) return;
    const html = cleanHtml(el.innerHTML);
    if (html !== EDIT.textSaved) {
      EDIT.textSaved = html;
      emit('edit', { type: 'text', path: pathOf(el), html, info: selInfo(), transaction: EDIT.textTransaction });
    }
  }
  function captureTextSelection() {
    if (!EDIT.textEl) return;
    const sel = getSelection();
    if (sel.rangeCount && EDIT.textEl.contains(sel.anchorNode) && EDIT.textEl.contains(sel.focusNode)) EDIT.range = sel.getRangeAt(0).cloneRange();
    EDIT.keepText = true;
  }
  function restoreTextSelection() {
    if (!EDIT.textEl) return;
    EDIT.textEl.focus();
    if (EDIT.range && EDIT.textEl.contains(EDIT.range.commonAncestorContainer)) {
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(EDIT.range);
    }
  }
  function cleanHtml(html) {
    const t = document.createElement('div');
    t.innerHTML = html;
    for (const el of t.querySelectorAll('*')) {
      el.classList.remove('visible', 'current-fragment', 'dek-editing-text');
      if (!el.classList.length) el.removeAttribute('class');
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
    }
    return t.innerHTML.trim();
  }
  function endTextMode() {
    const el = EDIT.textEl;
    if (!el) return null;
    el.removeAttribute('contenteditable');
    el.classList.remove('dek-editing-text');
    el.removeAttribute('spellcheck');
    clearTimeout(EDIT.textTimer);
    el.removeEventListener('input', onTextInput);
    el.removeEventListener('paste', onTextPaste);
    el.removeEventListener('keydown', onTextKey);
    el.removeEventListener('blur', onTextBlur);
    EDIT.textEl = null;
    return el;
  }
  function commitText() {
    flushText();
    const el = endTextMode();
    if (!el) return;
    const html = cleanHtml(el.innerHTML);
    if (html !== EDIT.textSaved) emit('edit', { type: 'text', path: pathOf(el), html, info: selInfo() });
    else emit('edit', { type: 'select', info: selInfo() });
    refreshSel();
  }
  function cancelText() {
    const el = endTextMode();
    if (!el) return;
    el.innerHTML = EDIT.textBackup;
    const html = cleanHtml(el.innerHTML);
    if (html !== EDIT.textSaved) emit('edit', { type: 'text', path: pathOf(el), html, info: selInfo() });
    refreshSel();
    emit('edit', { type: 'select', info: selInfo() });
  }

  function emitStyles(updates,label) {
    if(!updates.length)return;
    if(updates.length===1)emit('edit',{type:'style',path:pathOf(updates[0].el),style:updates[0].style,info:selInfo()});
    else emit('edit',{type:'batch',operations:updates.map(it=>({type:'style',target:pathOf(it.el),style:it.style})),label});
  }
  function groupGeometry(el) {
    if(!el.matches('.dek-group'))return [];
    return [...el.querySelectorAll('*')].filter(n=>!n.matches('script,style,.dek-sel,.dek-hover')).map(n=>{const cs=getComputedStyle(n),values={};for(const key of ['left','top','width','height','font-size','border-width','border-radius']){const value=cs.getPropertyValue(key);if(value.endsWith('px'))values[key]=parseFloat(value);}return{el:n,values};});
  }
  function scaleGroup(items,sx,sy) {
    if(!Number.isFinite(sx)||!Number.isFinite(sy))return [];
    return items.map(item=>{const style={};for(const [key,value] of Object.entries(item.values)){style[key]=(value*(['left','width'].includes(key)?sx:['top','height'].includes(key)?sy:Math.min(sx,sy)))+'px';item.el.style.setProperty(key,style[key]);}return{el:item.el,style};});
  }
  const editApi = {
    enable(on) {
      on = !!on;
      if (on === EDIT.on) return;
      EDIT.on = on;
      S.editing = on;
      document.documentElement.classList.toggle('dek-editing', on);
      document.body.classList.toggle('dek-static', on || !!S.opts.static);
      if (on) {
        document.addEventListener('mousedown', onEditMouseDown, true);
        document.addEventListener('mousemove', onEditMouseMove, true);
        document.addEventListener('mouseup', onEditMouseUp, true);
        document.addEventListener('dblclick', onEditDblClick, true);
        document.addEventListener('mouseleave', onEditMouseLeave, true);
        for (const el of $$('.dek-tilt')) el.style.transform = '';
        for (const fig of $$('.dek-chart')) { fig._dekType = null; renderChart(fig); }
      } else {
        if (EDIT.textEl) commitText();
        select(null);
        document.removeEventListener('mousedown', onEditMouseDown, true);
        document.removeEventListener('mousemove', onEditMouseMove, true);
        document.removeEventListener('mouseup', onEditMouseUp, true);
        document.removeEventListener('dblclick', onEditDblClick, true);
        document.removeEventListener('mouseleave', onEditMouseLeave, true);
        const sec = currentSection();
        if (sec) applyStep(sec, S.step, true);
      }
    },
    enabled() { return EDIT.on; },
    select(path, additive=false) { select(path ? unitFor(elAt(path)) : null,additive); return selInfo(); },
    selectMany(paths) { select(null); const units=[...new Set(paths.map(p=>unitFor(elAt(p))).filter(Boolean))];units.forEach(el=>select(el,true)); return selInfo(); },
    snapping() { return EDIT.snap; }, snap(on) { EDIT.snap=!!on; },
    selected: selInfo,
    clear() { select(null); },
    refresh: refreshSel,
    nudge(dx, dy) {
      const updates=EDIT.multi.filter(el=>!el.hasAttribute('data-dek-locked')).map(el=>{const [x,y]=parseTranslate(el);setTranslate(el,x+dx,y+dy);return{el,style:{translate:el.style.translate || null}};});
      refreshSel(); emitStyles(updates,'move elements');
    },
    setStyle(style) {
      const children=[];
      const updates=EDIT.multi.filter(el=>!el.hasAttribute('data-dek-locked')).map(el=>{if(el.matches('.dek-group')&&(style.width || style.height))children.push(...scaleGroup(groupGeometry(el),style.width?parseFloat(style.width)/el.offsetWidth:1,style.height?parseFloat(style.height)/el.offsetHeight:1));for(const[k,v]of Object.entries(style)) {if(v===null || v==='')el.style.removeProperty(k);else el.style.setProperty(k,v);}return{el,style};});
      updates.push(...children);
      refreshSel();emitStyles(updates,'style elements');
    },
    setAttrs(attrs) {
      const el = EDIT.sel;
      if (!el || el.hasAttribute('data-dek-locked')) return;
      for (const k in attrs) { if (attrs[k] === null) el.removeAttribute(k); else el.setAttribute(k, attrs[k]); }
      refreshSel();
      emit('edit', { type: 'attrs', path: pathOf(el), attrs, info: selInfo() });
    },
    deleteSelected() {
      if(EDIT.textEl)commitText();
      const paths=EDIT.multi.filter(el=>!el.hasAttribute('data-dek-locked')).map(pathOf);
      if(paths.length)emit('edit',{type:'batch',operations:[{type:'delete',targets:paths}],label:'delete elements'});
      select(null);
    },
    retag(tag) {
      const el = EDIT.sel;
      if(el?.hasAttribute('data-dek-locked'))return;
      if (!el || el.tagName.toLowerCase() === tag) return;
      if (EDIT.textEl === el) commitText();
      const path = pathOf(el);
      const n = document.createElement(tag);
      for (const a of Array.from(el.attributes)) n.setAttribute(a.name, a.value);
      while (el.firstChild) n.appendChild(el.firstChild);
      el.replaceWith(n);
      EDIT.sel = n;
      refreshSel();
      emit('edit', { type: 'retag', path, tag, info: selInfo() });
    },
    startText(opts) { if (EDIT.sel && kindOf(EDIT.sel) === 'text') startText(null, opts); },
    commitText,
    cancelText,
    captureTextSelection,
    textStyle(style) {
      restoreTextSelection();
      const sel = getSelection();
      if (EDIT.textEl && sel.rangeCount && !sel.isCollapsed && EDIT.textEl.contains(sel.anchorNode) && EDIT.textEl.contains(sel.focusNode)) {
        const range = sel.getRangeAt(0), span = document.createElement('span');
        for (const [k,v] of Object.entries(style)) span.style.setProperty(k, v);
        span.appendChild(range.extractContents()); range.insertNode(span);
        range.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(range); EDIT.range = range.cloneRange();
        flushText(); refreshSel();
      } else editApi.setStyle(style);
    },
    format(cmd) {
      if (!EDIT.sel || kindOf(EDIT.sel) !== 'text') return;
      if (!EDIT.textEl) startText(null, { selectAll: true });
      restoreTextSelection();
      document.execCommand(cmd); captureTextSelection(); flushText(); refreshSel();
      emit('edit', { type: 'select', info: selInfo() });
    },
    duplicate() {
      commitText();
      return EDIT.multi.map(el=>{
        const clone=el.cloneNode(true);
        for(const n of [clone,...clone.querySelectorAll('[id],[data-id],[data-dek-id]')]) { n.removeAttribute('data-dek-id');n.removeAttribute('data-dek-selected'); }
        clone.classList.remove('visible','current-fragment','dek-editing-text');
        const[x,y]=parseTranslate(el);setTranslate(clone,x+32,y+32);return clone.outerHTML;
      }).join('');
    },
    lock(locked) { emit('edit',{type:'batch',operations:[{type:'lock',targets:EDIT.multi.map(pathOf),locked}],label:locked?'lock elements':'unlock elements'}); },
    group() {
      commitText(); const list=EDIT.multi;
      if(list.length<2)return;
      if(list.some(n=>n.parentElement!==list[0].parentElement)) { emit('edit',{type:'notice',message:'Choose objects in the same container to group them.'});return; }
      const positions=list.map(n=>layoutRect(n,n.parentElement)), box={x:Math.min(...positions.map(r=>r.x)),y:Math.min(...positions.map(r=>r.y))};
      box.w=Math.max(...positions.map(r=>r.x+r.w))-box.x;box.h=Math.max(...positions.map(r=>r.y+r.h))-box.y;
      emit('edit',{type:'batch',operations:[{type:'group',targets:list.map(pathOf),box,positions}],label:'group elements'});
    },
    ungroup() {
      const el=EDIT.sel;if(!el?.matches('.dek-group'))return;
      const rotation=parseFloat(getComputedStyle(el).rotate)||0;
      emit('edit',{type:'batch',operations:[{type:'ungroup',target:pathOf(el),positions:Array.from(el.children).map(n=>({...layoutRect(n,el.parentElement),rotate:(parseFloat(getComputedStyle(n).rotate)||0)+rotation}))}],label:'ungroup elements'});
    },
    align(edge) {
      const list=EDIT.multi.filter(n=>!n.hasAttribute('data-dek-locked'));if(!list.length)return;
      const rs=list.map(slideRect), ref=list.length===1?{x:0,y:0,w:S.w,h:S.h}:{x:Math.min(...rs.map(r=>r.x)),y:Math.min(...rs.map(r=>r.y))};
      if(list.length>1){ref.w=Math.max(...rs.map(r=>r.x+r.w))-ref.x;ref.h=Math.max(...rs.map(r=>r.y+r.h))-ref.y;}
      const updates=list.map((el,i)=>{const r=rs[i],[x,y]=parseTranslate(el);const dx=edge==='left'?ref.x-r.x:edge==='right'?ref.x+ref.w-r.x-r.w:edge==='center'?ref.x+(ref.w-r.w)/2-r.x:0;const dy=edge==='top'?ref.y-r.y:edge==='bottom'?ref.y+ref.h-r.y-r.h:edge==='middle'?ref.y+(ref.h-r.h)/2-r.y:0;setTranslate(el,x+dx,y+dy);return{el,style:{translate:el.style.translate || null}};});
      emitStyles(updates,'align elements');refreshSel();
    },
    distribute(axis) {
      const list=EDIT.multi.filter(n=>!n.hasAttribute('data-dek-locked')).map(el=>({el,r:slideRect(el)})).sort((a,b)=>a.r[axis]-b.r[axis]);if(list.length<3)return;
      const size=axis==='x'?'w':'h',first=list[0].r,last=list[list.length-1].r;
      const gap=(last[axis]+last[size]-first[axis]-list.reduce((n,it)=>n+it.r[size],0))/(list.length-1);
      let cursor=first[axis];const updates=list.map(it=>{const[x,y]=parseTranslate(it.el),delta=cursor-it.r[axis];setTranslate(it.el,x+(axis==='x'?delta:0),y+(axis==='y'?delta:0));cursor+=it.r[size]+gap;return{el:it.el,style:{translate:it.el.style.translate || null}};});emitStyles(updates,'distribute elements');refreshSel();
    },
    link(url) {
      if(!EDIT.textEl)startText(null,{selectAll:true});restoreTextSelection();
      document.execCommand(url?'createLink':'unlink',false,url);captureTextSelection();flushText();
    },
    arrange(direction) {
      const el = EDIT.sel; if (!el) return;
      const values = Array.from(currentSection().children).filter(n=>!n.matches('.dek-sel,.dek-hover')).map(n=>parseInt(getComputedStyle(n).zIndex)||0);
      const z = direction === 'front' ? Math.max(...values,0)+1 : Math.min(...values,0)-1;
      editApi.setStyle({ position: getComputedStyle(el).position === 'static' ? 'relative' : el.style.position || null, 'z-index': String(z) });
    },
    geometry(key, value) {
      const el = EDIT.sel; if (!el || !Number.isFinite(value)) return;
      const r = slideRect(el), [x,y] = parseTranslate(el);
      if (key === 'x' || key === 'y') editApi.nudge(key==='x' ? value-r.x : 0,key==='y' ? value-r.y : 0);
    },
    center(axis) {
      const el = EDIT.sel; if (!el) return;
      const r = slideRect(el);
      editApi.nudge(axis==='x' ? (S.w-r.w)/2-r.x : 0,axis==='y' ? (S.h-r.h)/2-r.y : 0);
    },
    layers() {
      const sec=currentSection(); if (!sec) return [];
      const nodes=Array.from(sec.querySelectorAll('*')).map(unitFor).filter(Boolean);
      return Array.from(new Set(nodes)).filter(el=>!el.closest('.notes,.dek-sel,.dek-hover,script,style')).map(el=>({path:pathOf(el),kind:kindOf(el),locked:el.hasAttribute('data-dek-locked'),id:el.dataset.dekId || null,label:(el.getAttribute('alt') || el.textContent?.trim() || labelFor(el)).slice(0,60)})).reverse();
    },
    insert(html) {
      const sec = currentSection();
      if (!sec) return null;
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      const el = t.content.firstElementChild;
      if (!el) return null;
      sec.appendChild(t.content);
      if (EDIT.box && EDIT.box.parentElement === sec) { sec.appendChild(EDIT.hover); sec.appendChild(EDIT.box); }
      select(el);
      return pathOf(el);
    },
  };

  // ---------- public API ----------

  function stateOf() {
    const sec = S.sections[S.index];
    return {
      index: S.index,
      step: S.step,
      steps: stepsOf(S.index),
      count: S.sections.length,
      id: sec ? sec.id || '' : '',
      title: sec ? titleOf(sec) : '',
      notes: sec ? notesOf(sec) : { html: '', text: '' },
      transition: sec ? presetFor(sec) : '',
      autoAnimate: !!(sec && sec.hasAttribute('data-auto-animate')),
    };
  }

  function go(i, step, opts) {
    opts = opts || {};
    if (!S.sections.length) return false;
    const target = clamp(i | 0, 0, S.sections.length - 1);
    const from = S.sections[S.index];
    const to = S.sections[target];
    const dir = target >= S.index ? 1 : -1;
    const maxStep = stepsOf(target);
    const s = step === 'last' ? maxStep : clamp(step | 0, 0, maxStep);
    const sameSlide = from === to && S.ready;

    finishAnimations(from);
    if (from !== to) { cancelAnimations(to); resetTilt(from); }
    if (EDIT.on) { if (EDIT.textEl) commitText(); if (from !== to) select(null); }

    S.index = target;
    S.step = s;
    applyStep(to, s, true);

    if (sameSlide) {
      updateNumber();
    } else {
      runTransition(from, to, dir, !!opts.instant);
    }
    emit('change', stateOf());
    return true;
  }

  const api = {
    version: '0.1.0',
    edit: editApi,
    init(opts) {
      S.opts = Object.assign({ transition: 'fade', static: false, slideNumbers: false, autoslide: false }, opts || {});
      if (S.opts.size && S.opts.size.w && S.opts.size.h) { S.w = S.opts.size.w; S.h = S.opts.size.h; }
      document.documentElement.classList.add('dek-html');
      document.documentElement.style.setProperty('--dek-w', S.w + 'px');
      document.documentElement.style.setProperty('--dek-h', S.h + 'px');
      document.body.classList.add('dek-root');
      if (S.opts.static) document.body.classList.add('dek-static');
      expandComponents();
      S.sections = collectSections();
      for (const fig of $$('.dek-chart')) renderChart(fig);
      if (S.opts.slideNumbers && !S.opts.static) {
        S.numberEl = document.createElement('div');
        S.numberEl.className = 'dek-slide-number';
        document.body.appendChild(S.numberEl);
      }
      fit();
      window.addEventListener('resize', fit);
      if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
      requestAnimationFrame(fit);
      setTimeout(fit, 60);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('load', e=>{
        if(EDIT.on && EDIT.sel && (EDIT.sel===e.target || EDIT.sel.contains(e.target))) {
          refreshSel();emit('edit',{type:'select',info:selInfo()});
        }
      },true);
      // initial slide, no transition
      const start = clamp(S.opts.index | 0, 0, Math.max(0, S.sections.length - 1));
      S.index = start;
      const first = S.sections[start];
      if (first) {
        const s = S.opts.step === 'last' ? stepsOf(start) : clamp(S.opts.step | 0, 0, stepsOf(start));
        S.step = s;
        applyStep(first, s, true);
        first.classList.add('present');
        first.removeAttribute('aria-hidden');first.inert=false;
        if (!isStatic()) markActive(first, true);
        afterEnter(first, true);
      }
      const done = () => { if (S.ready) return; S.ready = true; emit('ready', stateOf()); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(done, done);
      setTimeout(done, 1500);
      emit('change', stateOf());
      return stateOf();
    },
    go,
    next() {
      if (S.step < stepsOf(S.index)) return go(S.index, S.step + 1);
      const n = neighbor(S.index, 1);
      return n >= 0 ? go(n, 0) : false;
    },
    prev() {
      if (S.step > 0) return go(S.index, S.step - 1);
      const p = neighbor(S.index, -1);
      return p >= 0 ? go(p, 'last') : false;
    },
    first() { const i = S.opts.skipHidden!==false && isSkipped(0) ? neighbor(0, 1) : 0; return go(i < 0 ? 0 : i, 0); },
    last() { const l = S.sections.length - 1; const i = S.opts.skipHidden!==false && isSkipped(l) ? neighbor(l, -1) : l; return go(i < 0 ? l : i, 'last'); },
    isSkipped,
    state: stateOf,
    count() { return S.sections.length; },
    slideAt(i) {
      const sec = S.sections[i];
      if (!sec) return null;
      return { index: i, id: sec.id || '', title: titleOf(sec), notes: notesOf(sec), steps: stepsOf(i), transition: presetFor(sec), skip: isSkipped(i) };
    },
    slides() { return S.sections.map((_, i) => api.slideAt(i)); },
    on(name, fn) { (S.listeners[name] = S.listeners[name] || []).push(fn); return () => api.off(name, fn); },
    off(name, fn) { S.listeners[name] = (S.listeners[name] || []).filter((f) => f !== fn); },
    setOptions(opts) {
      Object.assign(S.opts, opts || {});
      if (opts && 'slideNumbers' in opts) {
        if (opts.slideNumbers && !S.numberEl) {
          S.numberEl = document.createElement('div');
          S.numberEl.className = 'dek-slide-number';
          document.body.appendChild(S.numberEl);
        } else if (!opts.slideNumbers && S.numberEl) {
          S.numberEl.remove();
          S.numberEl = null;
        }
        updateNumber();
      }
      if (opts && 'autoslide' in opts) scheduleAutoslide(S.sections[S.index] || document.body);
    },
    fit,
    zoom() { return S.zoom; },
    /** Re-render charts (after a CSS hot swap changed their box or the deck's chart defaults). */
    refresh() { chartDefaults = null; for (const fig of $$('.dek-chart')) { fig._dekType = null; renderChart(fig); } updateNumber(); },
    ready() { return S.ready; },
  };

  window.dek = api;
})();
