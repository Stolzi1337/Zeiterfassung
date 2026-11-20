'use strict';

/* ================= Speicher ================= */
const KEY_STATE = 'zeit.state.v1';
const KEY_NAME = 'zeit.name';
const KEY_SITES = 'zeit.baustellen';

const TYPES = {
  work:   { label: 'Arbeit',       color: '#1f8a4c' },
  pause:  { label: 'Pause',        color: '#d99a00' },
  smoke:  { label: 'Raucherpause', color: '#a8622a' },
  driver: { label: 'Fahrzeit',     color: '#2a6fb8' },
  wait:   { label: 'Wartezeit',    color: '#7a4bb0' },
};
const STATUS_TEXT = {
  idle: 'Nicht gestartet', work: 'Arbeit läuft', pause: 'Pause', smoke: 'Raucherpause',
  driver: 'Fahrzeit', wait: 'Wartezeit', ended: 'Arbeitstag abgeschlossen',
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('Speichern nicht möglich!'); }
}
function emptyState() {
  return { status: 'idle', date: null, dayStart: null, dayEnd: null, draftSite: '', sites: [], events: [] };
}

let state = load(KEY_STATE, null) || emptyState();
let employee = load(KEY_NAME, '');
let knownSites = load(KEY_SITES, []);

function save() { store(KEY_STATE, state); }

/* ================= Zeit-Helfer ================= */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const minIdx = (t) => Math.floor(t / 60000);            // Minute seit 1970 (Sekunden werden abgeschnitten)
const hm = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const mins = (a, b) => Math.max(0, minIdx(b) - minIdx(a));
function fmtDur(m) { return Math.floor(m / 60) + ':' + pad(m % 60) + ' Std.'; }
function fmtDate(t) {
  return new Date(t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function isoDate(t) { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function uid() { return Math.random().toString(36).slice(2, 10); }

const isPause = (e) => e.type === 'pause' || e.type === 'smoke';
const openEvent = () => state.events.find((e) => e.end == null);
const currentSite = () => state.sites[state.sites.length - 1];

/** Pausenminuten (Pause + Raucherpause) innerhalb [a, b]. */
function pauseMinutes(a, b, now) {
  const A = minIdx(a), B = minIdx(b);
  let sum = 0;
  for (const e of state.events) {
    if (!isPause(e)) continue;
    const s = Math.max(A, minIdx(e.start));
    const en = Math.min(B, minIdx(e.end ?? now));
    if (en > s) sum += en - s;
  }
  return sum;
}
function netMinutes(now) {
  if (!state.dayStart) return 0;
  const end = state.dayEnd ?? now;
  return mins(state.dayStart, end) - pauseMinutes(state.dayStart, end, now);
}
function siteMinutes(site, now) {
  const end = site.end ?? now;
  return mins(site.start, end) - pauseMinutes(site.start, end, now);
}

/* ================= Aktionen ================= */
function locked() { return state.status === 'ended'; }

function rememberSite(name) {
  knownSites = [name, ...knownSites.filter((s) => s.toLowerCase() !== name.toLowerCase())].slice(0, 50);
  store(KEY_SITES, knownSites);
  fillSiteList();
}

function switchTo(type, t) {
  const open = openEvent();
  if (open) open.end = t;
  state.events.push({ id: uid(), type, start: t, end: null, reason: '' });
  state.status = type;
}

function doStart() {
  if (locked()) return;
  const t = Date.now();
  if (state.status === 'idle') {
    const name = $('siteInput').value.trim();
    if (!name) {
      const inp = $('siteInput');
      inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
      inp.focus();
      toast('Bitte zuerst den Namen der Baustelle eingeben.');
      return;
    }
    state.dayStart = t;
    state.date = isoDate(t);
    state.sites.push({ id: uid(), name, start: t, end: null, desc: '', material: '' });
    rememberSite(name);
    switchTo('work', t);
  } else if (state.status !== 'work') {
    switchTo('work', t);
  }
  save(); render();
}

function doBreak(type) {
  if (locked() || state.status === 'idle' || state.status === type) return;
  switchTo(type, Date.now());
  save(); render();
}

async function doEnd() {
  if (locked() || state.status === 'idle') return;
  const t = Date.now();
  const ok = await dialog({
    title: 'Wirklich beenden?',
    text: 'Der Arbeitstag wird um ' + hm(t) + ' Uhr abgeschlossen. Danach lässt sich nichts mehr ändern.',
    ok: 'Ja, beenden', danger: true,
  });
  if (!ok) return;
  const open = openEvent();
  if (open) open.end = t;
  const site = currentSite();
  if (site) site.end = t;
  state.dayEnd = t;
  state.status = 'ended';
  save(); render();
  $('doneCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function doChangeSite() {
  if (locked() || state.status === 'idle') return;
  const t = Date.now(); // genaue Uhrzeit des Tippens auf +
  const name = await dialog({
    title: 'Baustelle wechseln',
    text: 'Wechsel um ' + hm(t) + ' Uhr. Die bisherige Baustelle „' + currentSite().name + '“ endet dann. Neue Baustelle:',
    input: true, ok: 'Wechseln',
  });
  if (!name) return;
  const cur = currentSite();
  cur.end = t;
  state.sites.push({ id: uid(), name, start: t, end: null, desc: '', material: '' });
  rememberSite(name);
  save(); render();
  toast('Neue Baustelle: ' + name + ' (seit ' + hm(t) + ' Uhr)');
}

async function newDay() {
  const ok = await dialog({
    title: 'Neuen Arbeitstag beginnen?',
    text: 'Der abgeschlossene Tag wird vom Handy gelöscht. Hast du den Stundenzettel schon verschickt oder gespeichert?',
    ok: 'Ja, neuer Tag',
  });
  if (!ok) return;
  state = emptyState();
  save(); render();
  window.scrollTo({ top: 0 });
}

async function askName(force) {
  if (employee && !force) return;
  let name = '';
  while (!name) {
    name = await dialog({
      title: 'Dein Name',
      text: 'Bitte gib einmalig deinen Namen ein. Er steht auf jedem Stundenzettel.',
      input: true, value: employee, ok: 'Speichern', noCancel: !employee, noSuggest: true,
    });
    if (!name && employee) return;
  }
  employee = name;
  store(KEY_NAME, employee);
  render();
}

/* ================= Diktat ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let dict = null;

function joinText(a, b) {
  a = (a || '').trim(); b = (b || '').trim();
  if (!b) return a;
  if (!a) return b.charAt(0).toUpperCase() + b.slice(1);
  const sep = /[.!?:]$/.test(a) ? ' ' : (a.endsWith(',') ? ' ' : ', ');
  return a + sep + b;
}

/** target: { title, get(), set(text) } */
function dictate(target) {
  if (!SR) {
    toast('Spracherkennung wird von diesem Browser nicht unterstützt. Bitte den Text eintippen (Chrome oder Safari verwenden).');
    if (target.focusEl) target.focusEl.focus();
    return;
  }
  if (dict) return;
  dict = { target, base: target.get(), committed: '', stopped: false, gotSomething: false, rec: null };
  $('dTitle').textContent = target.title;
  $('dHint').textContent = 'Bitte sprechen … Tippe auf „Fertig“, wenn du fertig bist.';
  showDictText('');
  $('dictModal').hidden = false;
  startRec();
}

function startRec() {
  const d = dict;
  const rec = new SR();
  d.rec = rec;
  d.gotSomething = false;
  rec.lang = 'de-DE';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let sessionFinal = '';
  rec.onresult = (e) => {
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript + ' ';
      else interim += r[0].transcript + ' ';
    }
    sessionFinal = fin.trim();
    if (sessionFinal || interim.trim()) d.gotSomething = true;
    const text = joinText(d.base, joinText(d.committed, sessionFinal));
    d.target.set(text);
    showDictText(text, interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Kein Zugriff aufs Mikrofon. Bitte in den Browser-Einstellungen erlauben.');
      d.stopped = true;
    } else if (e.error === 'network') {
      toast('Die Spracherkennung braucht eine Internetverbindung.');
      d.stopped = true;
    }
  };
  rec.onend = () => {
    d.committed = joinText(d.committed, sessionFinal);
    // Weiter zuhören, solange "Fertig" nicht gedrückt wurde und noch gesprochen wird
    if (!d.stopped && d.gotSomething && dict === d) {
      try { startRec(); return; } catch (err) { /* fällt durch */ }
    }
    finishDictation();
  };
  try { rec.start(); } catch (err) { finishDictation(); }
}

function showDictText(text, interim) {
  const el = $('dText');
  el.textContent = text || '';
  if (interim) {
    const s = document.createElement('span');
    s.className = 'interim';
    s.textContent = (text ? ' ' : '') + interim;
    el.appendChild(s);
  }
  if (!text && !interim) el.textContent = '…';
  el.scrollTop = el.scrollHeight;
}

function stopDictation() {
  if (!dict) return;
  dict.stopped = true;
  try { dict.rec.stop(); } catch (e) { finishDictation(); }
  setTimeout(() => { if (dict) finishDictation(); }, 1500);
}

function finishDictation() {
  if (!dict) return;
  const d = dict;
  dict = null;
  d.target.set(joinText(d.base, d.committed) || d.target.get());
  $('dictModal').hidden = true;
  save();
}

/* Diktat-Ziele */
function siteTarget(site, field) {
  const label = field === 'desc' ? 'Beschreibung der Tätigkeit' : 'Verwendetes Material';
  const id = 'f-' + field + '-' + site.id;
  return {
    title: label + ' – ' + site.name,
    focusEl: $(id),
    get: () => site[field],
    set: (v) => { site[field] = v; const el = $(id); if (el) el.value = v; save(); },
  };
}
function waitTarget(ev) {
  const id = 'r-' + ev.id;
  return {
    title: 'Grund der Wartezeit (' + hm(ev.start) + ' Uhr)',
    focusEl: $(id),
    get: () => ev.reason,
    set: (v) => { ev.reason = v; const el = $(id); if (el) el.value = v; save(); },
  };
}

function dictateDesc(field) {
  if (locked() || state.status === 'idle') return;
  dictate(siteTarget(currentSite(), field));
}
function dictateWaitReason() {
  if (locked()) return;
  const open = openEvent();
  let ev = open && open.type === 'wait' ? open : null;
  if (!ev) ev = [...state.events].reverse().find((e) => e.type === 'wait');
  if (!ev) { toast('Es wurde noch keine Wartezeit erfasst.'); return; }
  dictate(waitTarget(ev));
}

/* ================= Anzeige ================= */
function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') n.className = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === true) n.setAttribute(k, '');
    else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

function fillSiteList() {
  const dl = $('siteList');
  dl.innerHTML = '';
  for (const s of knownSites) dl.append(el('option', { value: s }));
}

function render() {
  const st = state.status;
  const lockedNow = locked();
  const started = st !== 'idle';

  $('who').textContent = employee ? employee + (state.dayStart ? ' · ' + new Date(state.dayStart).toLocaleDateString('de-DE') : '') : '';

  // Baustellenfeld
  const inp = $('siteInput');
  if (started) {
    inp.value = currentSite() ? currentSite().name : '';
    inp.readOnly = true;
  } else {
    inp.readOnly = false;
    if (document.activeElement !== inp) inp.value = state.draftSite || '';
  }
  $('plusBtn').disabled = !started || lockedNow;

  // Knöpfe
  $('btnStart').disabled = lockedNow || st === 'work';
  $('btnStart').querySelector('span:last-child').textContent = (st === 'idle' || st === 'work' || lockedNow) ? 'Start' : 'Start (weiter)';
  for (const [id, type] of [['btnPause', 'pause'], ['btnSmoke', 'smoke'], ['btnDriver', 'driver'], ['btnWait', 'wait']]) {
    const b = $(id);
    b.disabled = !started || lockedNow || st === type;
    b.classList.toggle('active', st === type);
  }
  $('btnStart').classList.toggle('active', st === 'work');
  $('btnEnd').disabled = !started || lockedNow;
  $('btnDesc').disabled = !started || lockedNow;
  $('btnMat').disabled = !started || lockedNow;
  $('btnWaitMic').disabled = lockedNow || !state.events.some((e) => e.type === 'wait');

  // Hinweis auf alten, offenen Tag
  const banner = $('oldBanner');
  if (started && !lockedNow && state.date && state.date !== isoDate(Date.now())) {
    banner.hidden = false;
    banner.textContent = 'Achtung: Diese Erfassung vom ' + new Date(state.dayStart).toLocaleDateString('de-DE') + ' wurde noch nicht mit „Ende“ abgeschlossen.';
  } else banner.hidden = true;

  $('doneCard').hidden = !lockedNow;
  renderSites();
  renderLog();
  tick();
}

function renderSites() {
  const box = $('sites');
  box.innerHTML = '';
  $('sitesSection').hidden = state.sites.length === 0;
  const ro = locked();
  const now = Date.now();
  state.sites.forEach((site, i) => {
    const isCur = !ro && i === state.sites.length - 1;
    const card = el('div', { class: 'card site-card' + (isCur ? ' current' : '') });
    card.append(el('h3', null, site.name, isCur ? el('span', { class: 'tag' }, 'aktuell') : null));
    card.append(el('div', { class: 'when' },
      hm(site.start) + ' – ' + (site.end ? hm(site.end) : 'läuft') + ' Uhr · Arbeitszeit ' + fmtDur(siteMinutes(site, now))));
    for (const field of ['desc', 'material']) {
      const label = field === 'desc' ? 'Beschreibung der Tätigkeit' : 'Verwendetes Material';
      const ta = el('textarea', {
        id: 'f-' + field + '-' + site.id, readonly: ro, rows: 3,
        placeholder: ro ? '' : (field === 'desc' ? 'Diktieren oder eintippen …' : 'Diktieren oder eintippen …'),
        oninput: (e) => { site[field] = e.target.value; save(); },
      });
      ta.value = site[field];
      const head = el('div', { class: 'field-head' }, el('label', { for: ta.id }, label));
      if (!ro) head.append(el('button', { class: 'mic-sm', type: 'button', 'aria-label': label + ' diktieren', onclick: () => dictate(siteTarget(site, field)) }, '🎤'));
      card.append(el('div', { class: 'field' }, head, ta));
    }
    box.append(card);
  });
}

function renderLog() {
  const box = $('log');
  box.innerHTML = '';
  $('logSection').hidden = state.events.length === 0;
  const ro = locked();
  const now = Date.now();
  for (const ev of state.events) {
    const t = TYPES[ev.type];
    const time = hm(ev.start) + ' – ' + (ev.end ? hm(ev.end) : 'läuft') + ' · ' + fmtDur(mins(ev.start, ev.end ?? now));
    const row = el('div', { class: 'entry' },
      el('div', { class: 'entry-main' },
        el('span', { class: 'entry-type' }, el('span', { class: 'dot', style: 'background:' + t.color }), t.label),
        el('span', { class: 'entry-time', 'data-ev': ev.id }, time)));
    if (ev.type === 'wait') {
      const inp = el('input', {
        class: 'reason', id: 'r-' + ev.id, readonly: ro, placeholder: ro ? 'kein Grund angegeben' : 'Grund der Wartezeit …',
        oninput: (e) => { ev.reason = e.target.value; save(); },
      });
      inp.value = ev.reason || '';
      const rr = el('div', { class: 'reason-row' }, inp);
      if (!ro) rr.append(el('button', { class: 'mic-sm', type: 'button', 'aria-label': 'Grund diktieren', onclick: () => dictate(waitTarget(ev)) }, '🎤'));
      row.append(rr);
    }
    box.append(row);
  }
}

/** Uhr und laufende Zeiten jede Sekunde aktualisieren (ohne Eingabefelder neu zu zeichnen). */
function tick() {
  const now = Date.now();
  $('clock').textContent = hm(now);
  const st = state.status;
  const card = $('statusCard');
  card.className = 'card status s-' + st;
  $('statusLabel').textContent = STATUS_TEXT[st];
  const open = openEvent();
  if (st === 'idle') {
    $('statusDetail').textContent = 'Baustelle eingeben und auf Start tippen.';
    $('statusNet').textContent = '';
  } else if (st === 'ended') {
    $('statusDetail').textContent = hm(state.dayStart) + ' – ' + hm(state.dayEnd) + ' Uhr';
    $('statusNet').textContent = 'Netto-Arbeitszeit: ' + fmtDur(netMinutes(now));
  } else {
    $('statusDetail').textContent = 'seit ' + hm(open.start) + ' Uhr (' + fmtDur(mins(open.start, now)) + ') · Arbeitsbeginn ' + hm(state.dayStart) + ' Uhr';
    $('statusNet').textContent = 'Arbeitszeit bisher (ohne Pausen): ' + fmtDur(netMinutes(now));
  }
  if (open) {
    const span = document.querySelector('[data-ev="' + open.id + '"]');
    if (span) span.textContent = hm(open.start) + ' – läuft · ' + fmtDur(mins(open.start, now));
  }
}

/* ================= Dialog & Toast ================= */
function dialog({ title, text, input, value, ok, danger, noCancel, noSuggest }) {
  return new Promise((resolve) => {
    const m = $('modal'), inp = $('mInput'), okB = $('mOk'), cancelB = $('mCancel');
    $('mTitle').textContent = title;
    $('mText').textContent = text || '';
    inp.hidden = !input;
    inp.value = value || '';
    if (noSuggest) inp.removeAttribute('list'); else inp.setAttribute('list', 'siteList');
    okB.textContent = ok || 'OK';
    okB.classList.toggle('danger', !!danger);
    cancelB.hidden = !!noCancel;
    m.hidden = false;
    if (input) setTimeout(() => inp.focus(), 50);
    const done = (result) => {
      m.hidden = true;
      okB.onclick = cancelB.onclick = inp.onkeydown = null;
      resolve(result);
    };
    okB.onclick = () => {
      if (input) {
        const v = inp.value.trim();
        if (!v) { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); return; }
        done(v);
      } else done(true);
    };
    cancelB.onclick = () => done(input ? null : false);
    inp.onkeydown = (e) => { if (e.key === 'Enter') okB.onclick(); };
  });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ================= PDF ================= */
function buildPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 18, R = 192, W = R - L, BOTTOM = 280;
  let y = 20;
  const now = state.dayEnd;

  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 20; } };
  const font = (size, style, gray) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor(gray ?? 20); };
  const hline = (yy, gray) => { doc.setDrawColor(gray ?? 200); doc.setLineWidth(0.2); doc.line(L, yy, R, yy); };

  // Kopf
  font(20, 'bold'); doc.text('Stundenzettel', L, y);
  font(10, 'normal', 90); doc.text(fmtDate(state.dayStart), R, y, { align: 'right' });
  y += 9;
  font(11, 'normal', 90); doc.text('Mitarbeiter:', L, y);
  font(11, 'bold'); doc.text(employee || '—', L + 24, y);
  y += 6;
  font(11, 'normal', 90); doc.text('Datum:', L, y);
  font(11, 'bold'); doc.text(new Date(state.dayStart).toLocaleDateString('de-DE'), L + 24, y);
  y += 5;
  doc.setDrawColor(31, 111, 67); doc.setLineWidth(0.8); doc.line(L, y, R, y);
  y += 8;

  // Übersicht
  const pauseTotal = pauseMinutes(state.dayStart, state.dayEnd, now);
  const net = netMinutes(now);
  const boxes = [
    ['Arbeitsbeginn', hm(state.dayStart) + ' Uhr'],
    ['Arbeitsende', hm(state.dayEnd) + ' Uhr'],
    ['Pausen gesamt', fmtDur(pauseTotal)],
    ['Netto-Arbeitszeit', fmtDur(net)],
  ];
  const bw = W / 4;
  doc.setFillColor(243, 245, 242); doc.rect(L, y - 5, W, 15, 'F');
  boxes.forEach(([k, v], i) => {
    const x = L + i * bw + 3;
    font(8, 'normal', 100); doc.text(k.toUpperCase(), x, y);
    font(12, 'bold', i === 3 ? 0 : 20); doc.text(v, x, y + 6.5);
  });
  y += 18;

  const section = (title) => {
    ensure(18);
    y += 1;
    font(12, 'bold', 20); doc.text(title, L, y);
    y += 2.5; hline(y, 120); y += 5;
  };
  /** cols: [{t: Titel, w: Breite in mm, a: 'right'?}] */
  const table = (cols, rows, opts) => {
    opts = opts || {};
    const lh = 4.6;
    const head = () => {
      font(8.5, 'bold', 90);
      let x = L;
      for (const c of cols) { doc.text(c.t, c.a === 'right' ? x + c.w - 2 : x + 2, y, { align: c.a === 'right' ? 'right' : 'left' }); x += c.w; }
      y += 2; hline(y, 170); y += 4.5;
    };
    head();
    for (const row of rows) {
      font(10, row.bold ? 'bold' : 'normal', 20);
      const cells = row.cells.map((v, i) => doc.splitTextToSize(String(v ?? ''), cols[i].w - 4));
      const lines = Math.max(...cells.map((c) => c.length));
      const h = lines * lh;
      if (y + h > BOTTOM) { doc.addPage(); y = 20; head(); font(10, row.bold ? 'bold' : 'normal', 20); }
      let x = L;
      cells.forEach((c, i) => {
        const col = cols[i];
        doc.text(c, col.a === 'right' ? x + col.w - 2 : x + 2, y, { align: col.a === 'right' ? 'right' : 'left', lineHeightFactor: 1.3 });
        x += col.w;
      });
      y += h - lh + 2; hline(y, 225); y += 4.5;
    }
  };
  const note = (txt) => { ensure(8); font(10, 'italic', 120); doc.text(txt, L + 2, y); y += 7; };
  const totalLine = (label, value, strong) => {
    ensure(8);
    font(strong ? 11 : 10, 'bold', 20);
    doc.text(label, L + 2, y);
    doc.text(value, R - 2, y, { align: 'right' });
    y += strong ? 7 : 6;
  };

  // Baustellen
  section('Baustellen');
  table(
    [{ t: 'Baustelle', w: W - 84 }, { t: 'von', w: 22 }, { t: 'bis', w: 22 }, { t: 'Arbeitszeit', w: 40, a: 'right' }],
    state.sites.map((s) => ({ cells: [s.name, hm(s.start) + ' Uhr', hm(s.end) + ' Uhr', fmtDur(siteMinutes(s, now))] })),
  );

  // Pausen
  section('Pausen und Raucherpausen');
  const pauses = state.events.filter(isPause);
  if (pauses.length) {
    table(
      [{ t: 'Art', w: W - 106 }, { t: 'Beginn', w: 22 }, { t: 'Ende', w: 22 }, { t: 'Dauer', w: 62, a: 'right' }],
      pauses.map((e) => ({ cells: [TYPES[e.type].label, hm(e.start) + ' Uhr', hm(e.end) + ' Uhr', fmtDur(mins(e.start, e.end))] })),
    );
  } else note('Keine Pausen erfasst.');
  totalLine('Gesamtdauer aller Pausen', fmtDur(pauseTotal));
  ensure(10);
  doc.setFillColor(231, 241, 235); doc.rect(L, y - 5, W, 8, 'F');
  totalLine('Netto-Arbeitszeit', fmtDur(net), true);
  font(8.5, 'normal', 110);
  ensure(6);
  doc.text('Arbeitszeit ' + hm(state.dayStart) + '–' + hm(state.dayEnd) + ' Uhr = ' + fmtDur(mins(state.dayStart, state.dayEnd)) + ', abzüglich Pausen und Raucherpausen.', L + 2, y);
  y += 6;

  // Fahrzeit
  section('Fahrzeiten (nur zur Info)');
  const drives = state.events.filter((e) => e.type === 'driver');
  if (drives.length) {
    table(
      [{ t: 'Beginn', w: 30 }, { t: 'Ende', w: 30 }, { t: 'Dauer', w: W - 60, a: 'right' }],
      drives.map((e) => ({ cells: [hm(e.start) + ' Uhr', hm(e.end) + ' Uhr', fmtDur(mins(e.start, e.end))] })),
    );
  } else note('Keine Fahrzeiten erfasst.');

  // Wartezeiten
  section('Wartezeiten (nur zur Info)');
  const waits = state.events.filter((e) => e.type === 'wait');
  if (waits.length) {
    table(
      [{ t: 'Beginn', w: 22 }, { t: 'Ende', w: 22 }, { t: 'Dauer', w: 24 }, { t: 'Grund', w: W - 68 }],
      waits.map((e) => ({ cells: [hm(e.start) + ' Uhr', hm(e.end) + ' Uhr', fmtDur(mins(e.start, e.end)), e.reason || '—'] })),
    );
  } else note('Keine Wartezeiten erfasst.');

  // Tätigkeit & Material je Baustelle
  section('Tätigkeit und Material je Baustelle');
  const para = (label, txt) => {
    ensure(12);
    font(9, 'bold', 90); doc.text(label, L + 2, y); y += 5;
    font(10, 'normal', 20);
    const lines = doc.splitTextToSize(txt && txt.trim() ? txt.trim() : '—', W - 4);
    for (const ln of lines) { ensure(5); doc.text(ln, L + 2, y); y += 4.8; }
    y += 2;
  };
  state.sites.forEach((s, i) => {
    ensure(24);
    if (i > 0) { hline(y - 2, 225); y += 3; }
    font(11, 'bold', 20); doc.text(s.name, L + 2, y);
    font(9, 'normal', 110); doc.text(hm(s.start) + '–' + hm(s.end) + ' Uhr · ' + fmtDur(siteMinutes(s, now)), R - 2, y, { align: 'right' });
    y += 6;
    para('Beschreibung der Tätigkeit', s.desc);
    para('Verwendetes Material', s.material);
  });

  // Unterschrift
  if (y + 12 + 5 > 286) { doc.addPage(); y = 20; }
  y += 12;
  doc.setDrawColor(60); doc.setLineWidth(0.3);
  doc.line(L, y, L + 70, y);
  doc.line(R - 80, y, R, y);
  font(8.5, 'normal', 100);
  doc.text('Ort, Datum', L, y + 4.5);
  doc.text('Unterschrift ' + (employee || 'Mitarbeiter'), R - 80, y + 4.5);

  // Fußzeile
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    font(8, 'normal', 140);
    doc.text('Stundenzettel ' + (employee || '') + ' · ' + new Date(state.dayStart).toLocaleDateString('de-DE'), L, 290);
    doc.text('Seite ' + p + ' von ' + n, R, 290, { align: 'right' });
  }
  return doc;
}

function pdfName() {
  const n = (employee || 'Mitarbeiter').replace(/[^\wäöüÄÖÜß-]+/g, '_');
  return 'Stundenzettel_' + n + '_' + state.date + '.pdf';
}

async function sharePdf() {
  if (!locked()) return;
  let blob;
  try { blob = buildPdf().output('blob'); } catch (e) { toast('PDF konnte nicht erstellt werden.'); console.error(e); return; }
  const file = new File([blob], pdfName(), { type: 'application/pdf' });
  const datum = new Date(state.dayStart).toLocaleDateString('de-DE');
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Stundenzettel ' + datum, text: 'Anbei mein Stundenzettel vom ' + datum + '.\n\n' + employee });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Teilen hat nicht geklappt. Bitte „PDF ansehen / speichern“ verwenden.');
    }
  } else {
    downloadBlob(blob);
    toast('Teilen wird hier nicht unterstützt – das PDF wurde stattdessen gespeichert.');
  }
}

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: pdfName() });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function viewPdf() {
  if (!locked()) return;
  const blob = buildPdf().output('blob');
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) downloadBlob(blob);
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ================= Start ================= */
function init() {
  fillSiteList();
  $('siteInput').addEventListener('input', (e) => { if (state.status === 'idle') { state.draftSite = e.target.value; save(); } });
  $('siteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('plusBtn').onclick = doChangeSite;
  $('btnStart').onclick = doStart;
  $('btnPause').onclick = () => doBreak('pause');
  $('btnSmoke').onclick = () => doBreak('smoke');
  $('btnDriver').onclick = () => doBreak('driver');
  $('btnWait').onclick = () => doBreak('wait');
  $('btnWaitMic').onclick = dictateWaitReason;
  $('btnEnd').onclick = doEnd;
  $('btnDesc').onclick = () => dictateDesc('desc');
  $('btnMat').onclick = () => dictateDesc('material');
  $('dStop').onclick = stopDictation;
  $('btnShare').onclick = sharePdf;
  $('btnView').onclick = viewPdf;
  $('btnNewDay').onclick = newDay;
  $('btnName').onclick = () => askName(true);

  render();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  // Wenn die App in einem anderen Tab geändert wurde
  window.addEventListener('storage', (e) => { if (e.key === KEY_STATE) { state = load(KEY_STATE, emptyState()); render(); } });

  askName(false);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
