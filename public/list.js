'use strict';
const listId = location.pathname.split('/')[2] || '';
const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' KB' : n + ' B';
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.getElementById('batchNo').textContent = listId.toUpperCase();
document.getElementById('barNo').textContent = listId.toUpperCase();

function stamp(text, cls) { return `<span class="stamp ${cls}">${text}</span>`; }

async function main() {
  const box = document.getElementById('box');
  let j;
  try {
    const r = await fetch('/api/list/' + listId);
    if (!r.ok) { box.innerHTML = `<p><span class="stamp failed">Not on file</span></p><p class="dim">This batch does not exist, or its waybill has expired.</p>`; return; }
    j = await r.json();
  } catch {
    box.innerHTML = '<p class="error-line">Could not reach the server. Check the address and try again.</p>';
    return;
  }

  if (j.files.length === 0) { box.innerHTML = '<p class="dim">This manifest is empty, or every item has expired.</p>'; return; }

  const latest = Math.max(...j.files.map((f) => f.expiresAt || 0));
  if (latest) document.getElementById('expiry').textContent = new Date(latest).toLocaleString();

  const rows = j.files.map((f, i) => {
    const pct = f.size ? f.received / f.size : 0;
    const url = location.origin + '/d/' + f.id;
    const no = String(i + 1).padStart(3, '0');
    const st = f.done
      ? stamp('Delivered', 'delivered')
      : stamp(`In transit ${Math.round(pct * 100)}%`, 'transit');
    const act = f.done
      ? `<a href="${url}">Release item</a>`
      : `<span class="dim">link is issued when the item arrives</span>`;
    return `<div class="item${f.done ? ' done' : ''}">
      <span class="no">${no}</span>
      <span class="name">${esc(f.name)}</span>
      <span class="size">${fmt(f.size)}</span>
      <span>${st}</span>
      <div class="ruler"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="links">${act}</div>
    </div>`;
  }).join('');

  const done = j.files.filter((f) => f.done).length;
  box.innerHTML = `
    ${done > 1 ? `<div class="banner">${stamp('Bundle', 'transit')}
      <a href="/t/${listId}">Release all ${done} items as one (1) unit &mdash; .tar bundle</a></div>` : ''}
    <div class="items-wrap">${rows}</div>`;
}
main();

const tt = document.getElementById('themeToggle');
tt.textContent = document.documentElement.dataset.theme === 'dark' ? 'Day' : 'Night';
tt.onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('relay:theme', t); } catch {}
  tt.textContent = t === 'dark' ? 'Day' : 'Night';
};
