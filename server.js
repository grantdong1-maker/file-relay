#!/usr/bin/env node
/**
 * file-relay — zero-dependency Node.js server for relaying many/large files.
 *
 * Uploads are chunked and resumable (browser or plain curl), downloads stream
 * with HTTP Range support, and a whole batch can be fetched as one .tar.
 *
 * Run:  node server.js   (PORT / HOST / RELAY_TTL_HOURS env vars optional)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8199', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA, 'files');
const META_DIR = path.join(DATA, 'meta');
const LISTS_DIR = path.join(DATA, 'lists');
const PUBLIC = path.join(ROOT, 'public');

const MAX_CHUNK = 64 * 1024 * 1024;                     // 64 MB per chunk request
const DEFAULT_TTL_MS = (parseFloat(process.env.RELAY_TTL_HOURS) || 24) * 3600e3;
// Optional shared password for UPLOADING (downloads stay link-only).
// Set RELAY_PASS=... when exposing the server to the internet.
const RELAY_PASS = process.env.RELAY_PASS || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const handleCache = new Map(); // uploadId -> { fh }
function newId() { return crypto.randomBytes(8).toString('hex'); }

async function ensureDirs() {
  for (const d of [DATA, FILES_DIR, META_DIR, LISTS_DIR]) {
    await fsp.mkdir(d, { recursive: true });
  }
}

/* ---------------- metadata ---------------- */

const metaPath = (id) => path.join(META_DIR, id + '.json');
const listPath = (id) => path.join(LISTS_DIR, id + '.json');

async function readMeta(id) {
  try { return JSON.parse(await fsp.readFile(metaPath(id), 'utf8')); }
  catch { return null; }
}
async function writeMeta(id, m) {
  await fsp.writeFile(metaPath(id), JSON.stringify(m));
}
async function readList(id) {
  try { return JSON.parse(await fsp.readFile(listPath(id), 'utf8')); }
  catch { return null; }
}
async function writeList(id, l) {
  await fsp.writeFile(listPath(id), JSON.stringify(l));
}

/* Contiguous-length math from a merged range list of [start, end) pairs */
function mergeRanges(ranges) {
  const rs = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
function receivedBytes(ranges) {
  return mergeRanges(ranges).reduce((n, r) => n + (r[1] - r[0]), 0);
}

/* ---------------- file handles ---------------- */

async function getHandle(id) {
  let h = handleCache.get(id);
  if (!h) {
    h = { fh: await fsp.open(path.join(FILES_DIR, id), 'r+'), fhAt: Date.now() };
    handleCache.set(id, h);
  }
  return h;
}
async function closeHandle(id) {
  const h = handleCache.get(id);
  if (h) { await h.fh.close().catch(() => {}); handleCache.delete(id); }
}

/* ---------------- helpers ---------------- */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function contentDisposition(name) {
  const plain = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { reject(new Error('chunk too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function passOk(req, url) {
  if (!RELAY_PASS) return true;
  const given = req.headers['x-relay-pass'] || url.searchParams.get('pass') || '';
  return given === RELAY_PASS;
}

/* ---------------- API handlers ---------------- */

async function apiInit(req, res) {
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
  const name = String(body.name || 'file').slice(0, 200);
  const size = Math.max(0, Math.floor(Number(body.size) || 0));
  if (size <= 0) return sendJson(res, 400, { error: 'size must be > 0' });

  const requested = String(body.listId || '');
  const listId = /^[a-f0-9]{8,32}$/.test(requested) ? requested : newId();
  const id = newId();
  const token = newId();
  const ttl = Math.max(0.05, Math.min(24 * 30, Number(body.ttlHours) || DEFAULT_TTL_MS / 3600e3)) * 3600e3;

  await fsp.writeFile(path.join(FILES_DIR, id), '');
  await fsp.truncate(path.join(FILES_DIR, id), size); // sparse file, full length reserved

  const meta = {
    id, token, name, size, listId,
    createdAt: Date.now(), expiresAt: Date.now() + ttl,
    ranges: [], downloads: 0, done: false,
  };
  await writeMeta(id, meta);

  const list = (await readList(listId)) || { id: listId, files: [], createdAt: Date.now() };
  if (!list.files.includes(id)) list.files.push(id);
  await writeList(listId, list);

  sendJson(res, 200, { id, token, listId, size });
}

async function apiChunk(req, res, id) {
  const meta = await readMeta(id);
  if (!meta) return sendJson(res, 404, { error: 'unknown upload id' });

  const offset = Number(req.headers['x-offset'] || 0);
  const buf = await readBody(req, MAX_CHUNK);
  if (offset + buf.length > meta.size) return sendJson(res, 400, { error: 'write past end of file' });

  const h = await getHandle(id);
  await h.fh.write(buf, 0, buf.length, Number(offset));

  meta.ranges = mergeRanges([...meta.ranges, [Number(offset), Number(offset) + buf.length]]);
  const received = receivedBytes(meta.ranges);
  if (received >= meta.size) {
    meta.done = true;
    await closeHandle(id);
  }
  await writeMeta(id, meta);
  sendJson(res, 200, { received, size: meta.size, done: meta.done });
}

async function apiStream(req, res, id) {
  // Single-shot streaming upload for curl: PUT /api/stream/:id?offset=0
  const meta = await readMeta(id);
  if (!meta) return sendJson(res, 404, { error: 'unknown upload id' });
  const offset = Number(new URL(req.url, 'http://x').searchParams.get('offset') || 0);
  if (offset > meta.size) return sendJson(res, 400, { error: 'offset past end of file' });

  const file = path.join(FILES_DIR, id);
  if (!handleCache.has(id) && !(await fsp.stat(file).catch(() => null))) {
    await fsp.writeFile(file, '');
    await fsp.truncate(file, meta.size);
  }
  const ws = fs.createWriteStream(file, { flags: 'r+', start: offset });
  let bytes = 0, failed = false;
  req.on('data', (c) => {
    bytes += c.length;
    if (offset + bytes > meta.size) { failed = true; ws.destroy(); req.destroy(); }
  });
  req.on('error', () => { failed = true; ws.destroy(); });
  ws.on('error', () => { failed = true; req.destroy(); });
  await new Promise((done) => { req.pipe(ws); ws.on('close', done); });
  if (failed) return sendJson(res, 500, { error: 'write failed' });

  meta.ranges = mergeRanges([...meta.ranges, [offset, offset + bytes]]);
  const received = receivedBytes(meta.ranges);
  if (received >= meta.size) { meta.done = true; await closeHandle(id); }
  await writeMeta(id, meta);
  sendJson(res, 200, { received, size: meta.size, done: meta.done });
}

async function apiStatus(res, id) {
  const meta = await readMeta(id);
  if (!meta) return sendJson(res, 404, { error: 'unknown upload id' });
  sendJson(res, 200, {
    id: meta.id, name: meta.name, size: meta.size,
    received: receivedBytes(meta.ranges), done: meta.done,
    expiresAt: meta.expiresAt, downloads: meta.downloads,
  });
}

async function apiDelete(req, res, id) {
  const meta = await readMeta(id);
  if (!meta) return sendJson(res, 404, { ok: true });
  if (req.headers['x-token'] !== meta.token) return sendJson(res, 403, { error: 'bad token' });
  await closeHandle(id);
  await fsp.unlink(path.join(FILES_DIR, id)).catch(() => {});
  await fsp.unlink(metaPath(id)).catch(() => {});
  const list = await readList(meta.listId);
  if (list) {
    list.files = list.files.filter((x) => x !== id);
    await writeList(meta.listId, list);
  }
  sendJson(res, 200, { ok: true });
}

async function apiList(res, listId) {
  const list = await readList(listId);
  if (!list) return sendJson(res, 404, { error: 'unknown list' });
  const files = [];
  for (const fid of list.files) {
    const m = await readMeta(fid);
    if (!m) continue;
    files.push({
      id: m.id, name: m.name, size: m.size,
      done: m.done, received: receivedBytes(m.ranges),
      expiresAt: m.expiresAt,
    });
  }
  sendJson(res, 200, { id: listId, files, createdAt: list.createdAt });
}

/* ---------------- downloads ---------------- */

async function download(req, res, id) {
  const meta = await readMeta(id);
  if (!meta) { res.writeHead(404); return res.end('not found'); }
  if (Date.now() > meta.expiresAt) { res.writeHead(410); return res.end('this link has expired'); }
  if (meta.downloads >= 9999) { res.writeHead(429); return res.end('download limit reached'); }

  const file = path.join(FILES_DIR, id);
  const st = await fsp.stat(file).catch(() => null);
  if (!st) { res.writeHead(404); return res.end('file missing'); }

  const size = Math.min(st.size, meta.size) || st.size;
  const range = req.headers.range;
  let start = 0, end = size - 1, code = 200;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      code = 206;
      res.writeHead(code, {
        'content-type': 'application/octet-stream',
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'content-disposition': contentDisposition(meta.name),
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(code, {
    'content-type': 'application/octet-stream',
    'content-length': size,
    'accept-ranges': 'bytes',
    'content-disposition': contentDisposition(meta.name),
  });
  fs.createReadStream(file, { start, end }).pipe(res);

  // count only full downloads (not range probes)
  if (code === 200) {
    meta.downloads++;
    await writeMeta(id, meta);
  }
}

/* ---------------- tar streaming (download whole batch) ---------------- */

function tarHeader(name, size, mtimeSec) {
  const h = Buffer.alloc(512, 0);
  let n = Buffer.from(name.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 90), 'utf8');
  n.copy(h, 0);
  h.write('0000644\0', 100, 'ascii');           // mode
  h.write('0000000\0', 108, 'ascii');           // uid
  h.write('0000000\0', 116, 'ascii');           // gid
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  h.write(Math.floor(mtimeSec).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  h.fill(' ', 148, 156);                         // chksum placeholder
  h[156] = 0x30;                                 // typeflag '0'
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

function tarStream(listId) {
  return async function* () {
    const list = await readList(listId);
    if (!list) throw new Error('no list');
    const seen = new Set();
    for (const fid of list.files) {
      const m = await readMeta(fid);
      const st = await fsp.stat(path.join(FILES_DIR, fid)).catch(() => null);
      if (!m || !st || st.size < m.size) continue; // skip incomplete/missing
      let name = m.name || fid;
      while (seen.has(name)) name = '_' + name;
      seen.add(name);
      yield tarHeader(name, m.size, Date.now() / 1000);
      const fd = await fsp.open(path.join(FILES_DIR, fid), 'r');
      const buf = Buffer.allocUnsafe(1024 * 1024);
      let pos = 0;
      while (pos < m.size) {
        const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, m.size - pos), pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        yield buf.subarray(0, bytesRead);
      }
      await fd.close();
      const pad = (512 - (m.size % 512)) % 512;
      if (pad) yield Buffer.alloc(pad, 0);
    }
    yield Buffer.alloc(1024, 0); // end-of-archive marker
  };
}

/* ---------------- static files ---------------- */

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
}

/* ---------------- cleanup ---------------- */

async function cleanupOnce() {
  let metas = [];
  try { metas = await fsp.readdir(META_DIR); } catch { return; }
  for (const f of metas) {
    const id = f.replace(/\.json$/, '');
    const m = await readMeta(id);
    if (!m) continue;
    if (Date.now() > m.expiresAt) {
      await closeHandle(id);
      await fsp.unlink(path.join(FILES_DIR, id)).catch(() => {});
      await fsp.unlink(metaPath(id)).catch(() => {});
      const list = await readList(m.listId);
      if (list) {
        list.files = list.files.filter((x) => x !== id);
        if (list.files.length === 0) await fsp.unlink(listPath(m.listId)).catch(() => {});
        else await writeList(m.listId, list);
      }
    }
  }
}
setInterval(() => cleanupOnce().catch(() => {}), 5 * 60e3).unref();

/* ---------------- router ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/init' && req.method === 'POST') {
      if (!passOk(req, url)) return sendJson(res, 401, { error: 'password required', needPass: true });
      return await apiInit(req, res);
    }
    if (p.startsWith('/api/chunk/') && (req.method === 'PUT' || req.method === 'PATCH')) {
      if (!passOk(req, url)) return sendJson(res, 401, { error: 'password required', needPass: true });
      return await apiChunk(req, res, p.split('/')[3]);
    }
    if (p.startsWith('/api/stream/') && req.method === 'PUT') {
      if (!passOk(req, url)) return sendJson(res, 401, { error: 'password required', needPass: true });
      return await apiStream(req, res, p.split('/')[3]);
    }
    if (p.startsWith('/api/status/') && req.method === 'GET') return await apiStatus(res, p.split('/')[3]);
    if (p.startsWith('/api/files/') && req.method === 'DELETE') return await apiDelete(req, res, p.split('/')[3]);
    if (p.startsWith('/api/list/') && req.method === 'GET') return await apiList(res, p.split('/')[3]);

    if (p.startsWith('/d/') && req.method === 'GET') return await download(req, res, p.split('/')[2]);
    if (p.startsWith('/t/') && req.method === 'GET') {
      const listId = p.split('/')[2];
      if (!(await readList(listId))) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {
        'content-type': 'application/x-tar',
        'content-disposition': `attachment; filename="relay-${listId}.tar"`,
      });
      return ReadableFrom(tarStream(listId)).pipe(res);
    }
    if (p.startsWith('/l/') && req.method === 'GET') return sendFile(res, path.join(PUBLIC, 'list.html'));
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUBLIC, 'index.html'));

    // safe static assets
    const asset = path.normalize(p).replace(/^\/+/, '');
    if (/^[\w.-]+$/.test(asset) && (asset === 'app.js' || asset === 'style.css' || asset === 'list.js' || asset === 'capture.html')) {
      return sendFile(res, path.join(PUBLIC, asset));
    }
    const font = /^\/fonts\/[\w-]+\.woff2$/.exec(p);
    if (font) return sendFile(res, path.join(PUBLIC, 'fonts', path.basename(p)));

    res.writeHead(404); res.end('not found');
  } catch (err) {
    console.error(req.method, req.url, err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

const { Readable } = require('stream');
function ReadableFrom(gen) { return Readable.from(gen(), { highWaterMark: 512 * 1024 }); }

ensureDirs()
  .then(() => cleanupOnce())
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`file-relay listening on http://${HOST}:${PORT}`);
      console.log(`links expire after ${DEFAULT_TTL_MS / 3600e3}h; data dir: ${DATA}`);
    });
  })
  .catch((err) => { console.error('startup failed:', err); process.exit(1); });
