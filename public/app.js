/* file-relay uploader: chunked, resumable, many files / folders.
   Presentation: air waybill — every file is a manifest line item. */
'use strict';

const CHUNK = 8 * 1024 * 1024;      // 8 MB per chunk
const CONCURRENCY = 3;              // files uploading at once

const LS_UPLOADS = 'relay:uploads'; // id -> {token,listId,name,size}
const LS_LIST = 'relay:list';       // {listId}

const $ = (s) => document.querySelector(s);
const els = {
  drop: $('#drop'), fileInput: $('#fileInput'), folderInput: $('#folderInput'),
  items: $('#items'), listLink: $('#listLink'), sessionStat: $('#sessionStat'),
  controls: $('#controls'),
};

/* ---------- persistent state ---------- */
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

let uploads = loadJSON(LS_UPLOADS, {}); // server-side-resumable index

function getListId() {
  const s = loadJSON(LS_LIST, null);
  if (s && s.listId && Date.now() - (s.ts || 0) < 30 * 24 * 3600e3) return s.listId;
  return newSession();
}
function newSession() {
  const listId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  saveJSON(LS_LIST, { listId, ts: Date.now() });
  uploads = {};
  saveJSON(LS_UPLOADS, uploads);
  return listId;
}
function remember(u) { uploads[u.id] = { token: u.token, listId: u.listId, name: u.name, size: u.size }; saveJSON(LS_UPLOADS, uploads); }

/* ---------- state ---------- */
let listId = getListId();
let running = 0;
const queue = [];      // {file, id, paused, done, started, loaded, received, retried, no}
const HISTORY = {};    // key -> item (for hold/resume/void buttons)

/* ---------- ui ---------- */
function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const STAMPS = {
  queued: ['Queued', 'queued'],
  transit: ['In transit', 'transit'],
  hold: ['Hold', 'hold'],
  delivered: ['Delivered', 'delivered'],
  failed: ['Refused', 'failed'],
};

function makeItem(q, resumed) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <span class="no">${q.no}</span>
    <span class="name">${escapeHtml(q.file.name)}</span>
    <span class="size">${fmt(q.file.size)}</span>
    <span class="stampslot"><span class="stamp ${STAMPS.queued[1]}">${STAMPS.queued[0]}</span></span>
    <div class="ruler"><i></i></div>
    <span class="meter dim">${resumed ? 're-entry — checking progress' : 'awaiting carriage'}</span>
    <div class="links"></div>
    <span class="btns"></span>`;
  els.items.appendChild(li);
  return li;
}

function setItem(q, o) {
  const li = q.item;
  if (o.stamp) li.querySelector('.stamp').className = 'stamp ' + STAMPS[o.stamp][1];
  if (o.stamp) li.querySelector('.stamp').textContent = STAMPS[o.stamp][0];
  if (o.pct !== undefined) li.querySelector('.ruler i').style.width = ((o.pct || 0) * 100).toFixed(1) + '%';
  if (o.meter !== undefined) li.querySelector('.meter').textContent = o.meter;
  li.classList.toggle('done', !!o.done);
  li.classList.toggle('failed', !!o.err);
  li.classList.toggle('paused', !!o.paused);
  if (o.links !== undefined) li.querySelector('.links').innerHTML = o.links;
  if (o.btns !== undefined) li.querySelector('.btns').innerHTML = o.btns;
}

function linksFor(id) {
  const here = location.origin + '/d/' + id;
  return `release: <a href="${here}" target="_blank" rel="noopener">${here}</a>
          <button class="small" data-copy="${here}">Copy</button>`;
}
function btnsFor(q, st) {
  // q.key contains a NUL separator; NUL is replaced by U+FFFD when parsed back
  // out of an HTML attribute, so encode it to keep HISTORY lookups working.
  const k = encodeURIComponent(q.key);
  if (st === 'uploading') return `<button class="small" data-act="pause" data-k="${k}">Hold</button>`;
  if (st === 'paused') return `<button class="small" data-act="resume" data-k="${k}">Resume</button>`;
  if (st === 'done') return `<button class="small" data-act="cancel" data-k="${k}">Void</button>`;
  return '';
}

function updateSession() {
  const n = queue.length;
  els.controls.classList.toggle('hidden', n === 0);
  let up = 0, bytes = 0, size = 0;
  for (const q of queue) { size += q.file.size; if (q.done) up++; bytes += q.loaded; }
  els.sessionStat.textContent = n > 0 ? `Items ${up}/${n} · Weight ${fmt(bytes)} / ${fmt(size)}` : '';
  const allDone = n > 0 && up === n;
  els.listLink.classList.toggle('hidden', !allDone);
  els.listLink.innerHTML = allDone
    ? `<span class="stamp transit">Duplicate</span>
       <a href="/l/${listId}" target="_blank" rel="noopener">${helpHost()}/l/${listId}</a>
       <button class="small" id="copyList">Copy</button>`
    : '';
}
function helpHost() { return location.host; }

/* ---------- upload engine ---------- */
function schedule() {
  while (running < CONCURRENCY) {
    const next = queue.find((q) => !q.done && !q.paused && !q.running);
    if (!next) break;
    next.running = true;
    running++;
    uploadItem(next).finally(() => { running--; next.running = false; schedule(); });
  }
}

async function initUpload(q) {
  const body = JSON.stringify({ name: q.file.name, size: q.file.size, listId });
  const r = await fetch('/api/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...passHeaders() },
    body,
  });
  if (r.status === 401) { passPrompt(); return initUpload(q); }
  if (!r.ok) throw new Error('init failed: ' + r.status);
  const j = await r.json();
  q.id = j.id; q.token = j.token;
  remember({ id: j.id, token: j.token, listId: j.listId, name: q.file.name, size: q.file.size });
  updateSession();
  return j;
}

async function uploadItem(q) {
  let received = q.received || 0;

  if (q.id) {
    // resuming a remembered id: confirm state, or re-init if gone
    try {
      const st = await fetch('/api/status/' + q.id);
      if (!st.ok) q.id = null;
      else {
        const j = await st.json();
        received = Math.max(received, j.received);
      }
    } catch { /* network hiccup; chunk loop will retry */ }
  }
  if (!q.id) {
    try { await initUpload(q); }
    catch (e) { return fail(q, e); }
  }

  q.received = received;
  setItem(q, { stamp: 'transit', meter: 'in transit', btns: btnsFor(q, 'uploading') });
  q.started = performance.now();

  while (q.received < q.file.size && !q.paused) {
    const off = q.received;
    const blob = q.file.slice(off, Math.min(off + CHUNK, q.file.size));

    let r;
    try {
      r = await fetch('/api/chunk/' + q.id, {
        method: 'PUT',
        headers: { 'x-offset': String(off), ...passHeaders() },
        body: blob,
      });
    } catch { r = null; }

    if (!r || !r.ok) {
      if (r && r.status === 401) { passFailed(); continue; }
      if (r && r.status === 404) { q.id = null; q.received = 0; return uploadItem(q).then(() => {}); }
      q.retried = (q.retried || 0) + 1;
      if (q.retried > 6) return fail(q, r ? new Error('HTTP ' + r.status) : new Error('network error'));
      setItem(q, { stamp: 'hold', meter: `retrying in ${2 * q.retried}s (attempt ${q.retried})` });
      await sleep(2000 * q.retried);
      // resync with server
      try {
        const st = await fetch('/api/status/' + q.id);
        if (st.ok) q.received = (await st.json()).received;
      } catch {}
      continue;
    }

    const j = await r.json();
    q.retried = 0;
    q.received = Math.min(j.received, q.file.size);
    q.loaded = q.received;
    paint(q);
  }

  if (q.paused) { setItem(q, { stamp: 'hold', paused: true, meter: 'held — ' + pctText(q), btns: btnsFor(q, 'paused') }); return; }

  q.done = true;
  delete uploads[q.id];
  saveJSON(LS_UPLOADS, uploads);
  setItem(q, {
    done: true, stamp: 'delivered', pct: 1,
    meter: 'delivered · ' + fmt(q.received),
    links: linksFor(q.id), btns: btnsFor(q, 'done'),
  });
  updateSession();
}

function pctText(q) { return q.file.size ? Math.round((q.received / q.file.size) * 100) + '%' : '0%'; }

function fail(q, err) {
  setItem(q, {
    err: true, stamp: 'failed', pct: q.received / q.file.size,
    meter: 'refused by carrier',
    links: `<span class="error-line">failed: ${escapeHtml(String(err.message || err))}</span>`,
    btns: '',
  });
  updateSession();
}

function paint(q) {
  const pct = q.file.size ? q.received / q.file.size : 1;
  const speed = (performance.now() - q.started) > 300
    ? fmt(q.received / ((performance.now() - q.started) / 1000)) + '/s' : '';
  setItem(q, { pct, meter: `${Math.round(pct * 100)}% · ${fmt(q.received)}${speed ? ' · ' + speed : ''}` });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- optional shared password (uploader side) ---------- */
function getPass() {
  let p = sessionStorage.getItem('relay:pass');
  if (p === null) {
    p = prompt('This server requires a shipper password. Ask the operator, or leave empty:') || '';
    sessionStorage.setItem('relay:pass', p);
  }
  return p;
}
// Only send a stored password; never block on a prompt unless the server asks (401).
function passHeaders() {
  const p = sessionStorage.getItem('relay:pass');
  return p ? { 'x-relay-pass': p } : {};
}
function passFailed() { sessionStorage.removeItem('relay:pass'); }
function passPrompt() { sessionStorage.removeItem('relay:pass'); getPass(); }

/* ---------- adding files ---------- */
function addFiles(files) {
  els.controls.classList.remove('hidden');
  for (const file of files) {
    const key = file.name + '\0' + file.size;
    if (HISTORY[key] || queue.some((q) => q.file === file)) continue;
    const q = { file, paused: false, done: false, received: 0, loaded: 0, key, no: String(els.items.children.length + 1).padStart(3, '0') };
    q.item = makeItem(q, false);
    HISTORY[key] = q;
    // resume from a previous visit if we have a token for this name+size in this batch
    const entry = Object.entries(uploads).find(([, u]) => u.name === file.name && u.size === file.size && u.listId === listId);
    if (entry) { q.id = entry[0]; q.token = entry[1].token; q.reentry = true; }
    queue.push(q);
    if (q.reentry) setItem(q, { stamp: 'transit', meter: 're-entry — checking progress' });
    else setItem(q, { stamp: 'queued', meter: 'awaiting carriage' });
  }
  updateSession();
  schedule();
}

/* ---------- events ---------- */
els.drop.addEventListener('dragover', (e) => { e.preventDefault(); els.drop.classList.add('over'); });
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('over'));
els.drop.addEventListener('drop', (e) => { e.preventDefault(); els.drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

$('#pickFiles').onclick = () => els.fileInput.click();
$('#pickFolder').onclick = () => els.folderInput.click();
els.fileInput.onchange = () => { addFiles([...els.fileInput.files]); els.fileInput.value = ''; };
els.folderInput.onchange = () => { addFiles([...els.folderInput.files]); els.folderInput.value = ''; };

$('#pauseAll').onclick = () => queue.forEach((q) => { if (!q.done) q.paused = true; });
$('#resumeAll').onclick = () => { queue.forEach((q) => { if (!q.done) q.paused = false; }); schedule(); };

$('#newSession').onclick = () => {
  listId = newSession();
  queue.length = 0;
  running = 0;
  els.items.innerHTML = '';
  markBatch();
  updateSession();
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act) {
    const q = HISTORY[decodeURIComponent(b.dataset.k)];
    if (!q) return;
    if (b.dataset.act === 'pause') { q.paused = true; setItem(q, { stamp: 'hold', paused: true, meter: 'held — ' + pctText(q), btns: btnsFor(q, 'paused') }); }
    if (b.dataset.act === 'resume') { q.paused = false; setItem(q, { stamp: 'transit', meter: 're-entry — checking progress', btns: '' }); schedule(); }
    if (b.dataset.act === 'cancel') {
      q.paused = true; q.done = true;
      q.item.remove();
      queue.splice(queue.indexOf(q), 1);
      if (q.id && uploads[q.id]) {
        fetch('/api/files/' + q.id, { method: 'DELETE', headers: { 'x-token': q.token } }).catch(() => {});
        delete uploads[q.id];
        saveJSON(LS_UPLOADS, uploads);
      }
      updateSession();
    }
  }
  if (b.dataset.copy) {
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied!'; setTimeout(() => (b.textContent = 'Copy'), 1200); });
  }
  if (b.id === 'copyList') {
    navigator.clipboard.writeText(location.origin + '/l/' + listId).then(() => { b.textContent = 'Copied!'; setTimeout(() => (b.textContent = 'Copy'), 1200); });
  }
  if (b.id === 'themeToggle') {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('relay:theme', t); } catch {}
    b.textContent = t === 'dark' ? 'Day' : 'Night';
  }
});

/* ---------- waybill header ---------- */
function markBatch() {
  $('#batchNo').textContent = listId.toUpperCase();
  $('#barNo').textContent = listId.toUpperCase();
}
markBatch();
// sync the day/night label with the theme the page actually booted into
$('#themeToggle').textContent = document.documentElement.dataset.theme === 'dark' ? 'Day' : 'Night';
updateSession();
