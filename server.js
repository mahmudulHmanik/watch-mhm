// DhakaFlix Browser: crawler + fuzzy search + proxy/streaming. Run on a machine inside your BDIX network.
const express = require('express'), cheerio = require('cheerio'), Fuse = require('fuse.js');
const fs = require('fs'), { spawn } = require('child_process'), { Readable } = require('stream');
const cfg = require('./config.json'), PORT = process.env.PORT || 3000, IDX = 'index.json';
const hosts = new Set(cfg.sections.map(s => new URL(s.url).host));
const allowed = u => { try { const x = new URL(u); return x.protocol === 'http:' && hosts.has(x.host); } catch { return false; } };
let items = [], fuse = null, crawling = false;

async function ls(url) { // parse an h5ai directory page
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const $ = cheerio.load(await r.text()), out = [];
  $('#fallback tr').each((_, tr) => {
    const a = $(tr).find('td.fb-n a'); if (!a.length || a.attr('href') === '..') return;
    const u = new URL(a.attr('href'), url).href;
    out.push({ name: a.text().trim(), url: u, dir: u.endsWith('/'), date: $(tr).find('td.fb-d').text().trim(), size: $(tr).find('td.fb-s').text().trim() });
  });
  return out;
}
const GROUP = /^(?:\(\d{4}(?:-\d{4})?\)(?:\s.*)?|\d{4}(?:\s+&\s+Before)?$|.*\s[^\w\s]\s+\S+\s+\u2014\s+\S+\s*)$/i; // year folders and A-Z buckets: descend, don't list
const GROUP_YEAR = /^(?:\((?:TV (?:Mini )?Series )?(\d{4})(?:-\d{4})?\)|(\d{4})(?:\s+&\s+Before)?)(?:\s|$)/i;
function groupYear(name) {
  const m = name.match(GROUP_YEAR);
  return m ? m[1] || m[2] || '' : '';
}
function mk(d, s, yearHint = '') {
  const year = ((d.name.match(/\((?:[^)]*?\s)?((?:19|20)\d{2})\b/) || [])[1]
    || (d.name.match(/(?:^|[^\d])((?:19|20)\d{2})(?=[^\d]|$)/) || [])[1]
    || yearHint);
  const title = d.name.replace(/\s*\((?:TV (?:Mini )?Series )?\d{4}.*$/, '').replace(/\s*\b(2160p|1080p|720p|480p)\b.*$/i, '').trim() || d.name;
  return {
    title, year, quality: (d.name.match(/2160p|1080p|720p|480p/i) || [''])[0], dual: /dual audio/i.test(d.name),
    section: s.name, type: s.type, url: d.url, date: d.date, search: (title + ' ' + year).replace(/[-_.:]/g, ' ').toLowerCase()
  };
}
const INDEX_VERSION = 4, TITLE_FILE = /\.(mkv|mp4|m4v|avi|webm|mov|ts|jpe?g|png|webp|nfo)$/i, SEASONY = /^(season|series|s)\s*\.?\s*\d+|^specials?$|^extras?$/i;
async function looksLikeGroups(dirs) { // sample first / middle / last folder: if none holds video or poster files (or season folders), this level only groups other folders
  let sawDirs = false;
  for (const d of [...new Set([0, Math.floor(dirs.length / 2), dirs.length - 1])].map(i => dirs[i])) {
    const l = await ls(d.url).catch(() => []), sub = l.filter(x => x.dir);
    if (l.some(x => !x.dir && TITLE_FILE.test(x.name)) || (sub.length && sub.every(x => SEASONY.test(x.name)))) return false;
    if (sub.length) sawDirs = true;
  }
  return sawDirs;
}
async function walk(url, s, all, depth, trace, yearHint = '') { // trace(depth, text) is optional and used by /api/inspect
  const dirs = (await ls(url)).filter(x => x.dir), pat = dirs.filter(d => GROUP.test(d.name)), rest = dirs.filter(d => !GROUP.test(d.name)), say = (t) => trace && trace(depth, t);
  if (pat.length) say(`${pat.length} grouping folder(s) by name: ${pat.slice(0, 3).map(d => d.name).join(' | ')}${pat.length > 3 ? ' ...' : ''}`);
  for (const d of pat) { if (depth < 4) await walk(d.url, s, all, depth + 1, trace, groupYear(d.name) || yearHint); else all.push(mk(d, s, yearHint)); }
  if (!rest.length) return;
  const groups = depth < 4 && ((depth === 0 && s.groups) || (!pat.length && await looksLikeGroups(rest)));
  say(`${rest.length} folder(s) are ${groups ? 'GROUPS, going deeper' : 'TITLES'}: ${rest.slice(0, 3).map(d => d.name).join(' | ')}${rest.length > 3 ? ' ...' : ''}`);
  if (groups) for (const d of rest) await walk(d.url, s, all, depth + 1, trace, yearHint); else rest.forEach(d => all.push(mk(d, s, yearHint)));
}
async function crawl(only = []) { // only = names of collections to rescan; empty = all
  if (crawling) return; crawling = true;
  const secs = only.length ? cfg.sections.filter(s => only.includes(s.name)) : cfg.sections, all = [], first = !items.length;
  for (const s of secs) {
    try { await walk(s.url, s, all, 0); console.log('indexed', s.name, all.length); if (first) { items = all.slice(); build(); } }
    catch (e) { console.error('failed', s.name, e.message); }
  }
  if (all.length) { const done = new Set(all.map(i => i.section)); items = items.filter(i => !done.has(i.section)).concat(all); fs.writeFileSync(IDX, JSON.stringify({ version: INDEX_VERSION, items })); build(); }
  crawling = false;
}
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019"!^$|=]/g, '').replace(/[-_.:,&()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
const build = () => { items.forEach(i => i.search = norm(i.title + ' ' + i.year)); fuse = new Fuse(items, { keys: ['search'], threshold: 0.3, ignoreLocation: true, useExtendedSearch: true }); };
function find(q, list) { // exact word matches first (any word order, best match first), then typo-tolerant matches
  const toks = q.split(' '), keep = new Set(list), ex = [];
  for (const i of list) if (toks.every(t => i.search.includes(t))) ex.push([i.search.startsWith(q) ? 0 : i.search.includes(q) ? 1 : 2, i]);
  ex.sort((a, b) => a[0] - b[0] || a[1].search.length - b[1].search.length);
  const out = ex.map(x => x[1]);
  if (out.length < 10 && fuse) { const seen = new Set(out); for (const r of fuse.search(toks.join(' ')).slice(0, 300)) if (keep.has(r.item) && !seen.has(r.item)) out.push(r.item); }
  return out;
}
if (fs.existsSync(IDX)) {
  const j = JSON.parse(fs.readFileSync(IDX)); items = Array.isArray(j) ? j : j.items; build();
  if (Array.isArray(j) || j.version !== INDEX_VERSION) { console.log('Library index is from an older version. Rescanning in the background (the app stays usable).'); crawl(); }
} else crawl();

const app = express(); app.use(express.static('public'));
app.get('/api/status', (_, r) => r.json({ crawling, total: items.length }));
app.post('/api/crawl', (q, r) => { crawl([].concat(q.query.section || [])); r.json({ started: true }); }); // ?section=Name (repeatable) rescans only those
app.get('/api/sections', (_, r) => r.json(cfg.sections.map(s => ({ name: s.name, type: s.type, count: items.filter(i => i.section === s.name).length }))));
const sorted = (l, by) => [...l].sort((a, b) => by === 'title' ? a.title.localeCompare(b.title)
  : by === 'yearAsc' ? (a.year || '9999').localeCompare(b.year || '9999') || a.title.localeCompare(b.title) : (b.year || '0').localeCompare(a.year || '0') || a.title.localeCompare(b.title));
app.get('/api/years', (q, r) => { // years present in the current type / collection, newest first, with counts
  const { type = '', section = '' } = q.query, c = {};
  items.forEach(i => { if (i.year && (!type || i.type === type) && (!section || i.section === section)) c[i.year] = (c[i.year] || 0) + 1; });
  r.json(Object.entries(c).map(([year, count]) => ({ year, count })).sort((a, b) => b.year.localeCompare(a.year)));
});
app.get('/api/items', (q, r) => {
  const { type = '', section = '', year = '', sort = '', q: s = '', offset = 0, limit = 60 } = q.query;
  let list = items.filter(i => (!type || i.type === type) && (!section || i.section === section) && (!year || i.year === year));
  try {
    if (norm(s)) list = find(norm(s), list); else list = [...list].sort((a, b) => b.date.localeCompare(a.date));
    if (sort) list = sorted(list, sort);
    r.json({ total: list.length, items: list.slice(+offset, +offset + +limit) });
  } catch (e) { console.error('search failed', e); r.status(500).json({ error: e.message }); }
});
app.get('/api/folder', async (q, r) => { // contents of one folder (seasons, episodes, files)
  if (!allowed(q.query.u)) return r.sendStatus(400);
  try { r.json(await ls(q.query.u)); } catch (e) { r.status(502).json({ error: e.message }); }
});
const posters = new Map();
app.get('/api/poster', async (q, r) => { // first image in a folder, proxied so the browser needs no BDIX access
  const u = q.query.u; if (!allowed(u)) return r.sendStatus(400);
  try {
    if (!posters.has(u)) { const f = (await ls(u)).filter(x => !x.dir && /\.(jpe?g|png|webp)$/i.test(x.name)); posters.set(u, (f.find(x => /poster|folder|cover/i.test(x.name)) || f[0] || {}).url || null); }
    const img = posters.get(u); if (!img) return r.sendStatus(404);
    const up = await fetch(img); r.set('Content-Type', up.headers.get('content-type') || 'image/jpeg'); r.set('Cache-Control', 'public, max-age=604800');
    Readable.fromWeb(up.body).pipe(r);
  } catch { r.sendStatus(502); }
});
app.get('/stream', async (q, r) => { // range-capable proxy for playback and download
  const u = q.query.u; if (!allowed(u)) return r.sendStatus(400);
  try {
    const up = await fetch(u, { headers: q.headers.range ? { range: q.headers.range } : {} });
    r.status(up.status);
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) if (up.headers.get(k)) r.set(k, up.headers.get(k));
    if (q.query.dl) r.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(decodeURIComponent(u.split('/').pop())));
    Readable.fromWeb(up.body).pipe(r); q.on('close', () => up.body.cancel().catch(() => { }));
  } catch { r.sendStatus(502); }
});
app.get('/transcode', (q, r) => { // needs ffmpeg. mode=audio keeps video, converts sound to stereo AAC; mode=full re-encodes video too
  if (!allowed(q.query.u)) return r.sendStatus(400);
  const v = q.query.mode === 'full' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy'];
  const p = spawn(cfg.ffmpeg || 'ffmpeg', ['-loglevel', 'error', ...(+q.query.t > 0 ? ['-ss', String(+q.query.t)] : []), '-i', q.query.u, '-map', '0:v:0', '-map', '0:a:' + (+q.query.a || 0) + '?', ...v, '-c:a', 'aac', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']);
  r.set('Content-Type', 'video/mp4'); p.stdout.pipe(r); p.on('error', () => r.end()); q.on('close', () => p.kill('SIGKILL'));
});
// ---- audio/subtitle tracks: ffprobe + WebVTT extraction (ffprobe ships with ffmpeg) ----
const crypto = require('crypto'); fs.mkdirSync('cache', { recursive: true });
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args), b = [];
  p.stdout.on('data', d => b.push(d)); p.on('error', rej);
  p.on('close', c => c === 0 && b.length ? res(Buffer.concat(b).toString()) : rej(new Error(cmd + ' failed')));
});
const shift = (t, s) => !s ? t : t.replace(/(?:(\d+):)?(\d\d):(\d\d)\.(\d{3})/g, (_, h, m, sec, ms) => {
  const x = Math.max(0, +(h || 0) * 3600 + +m * 60 + +sec + +ms / 1000 - s), p = n => String(n).padStart(2, '0');
  return p(Math.floor(x / 3600)) + ':' + p(Math.floor(x % 3600 / 60)) + ':' + (x % 60).toFixed(3).padStart(6, '0');
});
const probes = new Map(), subJobs = new Map(), IMG = /pgs|dvd_sub|dvb_sub|xsub/i;
app.get('/api/probe', async (q, r) => {
  const u = q.query.u; if (!allowed(u)) return r.sendStatus(400);
  try {
    if (!probes.has(u)) {
      const j = JSON.parse(await run(cfg.ffprobe || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', u]));
      const by = t => j.streams.filter(s => s.codec_type === t), tag = s => ({ lang: (s.tags && s.tags.language) || '', title: (s.tags && s.tags.title) || '', codec: s.codec_name });
      probes.set(u, {
        duration: +(j.format && j.format.duration) || 0, video: (by('video')[0] || {}).codec_name || '',
        audio: by('audio').map((s, i) => ({ i, ...tag(s), channels: s.channels })),
        subs: by('subtitle').map((s, i) => ({ i, ...tag(s), text: !IMG.test(s.codec_name) }))
      });
    }
    r.json(probes.get(u));
  } catch { r.status(501).json({ error: 'ffprobe unavailable or failed' }); }
});
app.get('/api/sub', async (q, r) => { // WebVTT from an embedded track (s=index) or a subtitle file (file=1); shift= seconds to subtract
  const u = q.query.u; if (!allowed(u)) return r.sendStatus(400);
  const emb = q.query.file ? null : +q.query.s || 0, key = 'cache/' + crypto.createHash('md5').update(u + '|' + emb).digest('hex') + '.vtt';
  try {
    if (!fs.existsSync(key)) {
      if (!subJobs.has(key)) subJobs.set(key, run(cfg.ffmpeg || 'ffmpeg', ['-loglevel', 'error', '-i', u, ...(emb === null ? [] : ['-map', '0:s:' + emb]), '-f', 'webvtt', 'pipe:1'])
        .then(t => fs.writeFileSync(key, t)).finally(() => subJobs.delete(key)));
      await subJobs.get(key);
    }
    r.type('text/vtt').send(shift(fs.readFileSync(key, 'utf8'), +q.query.shift || 0));
  } catch { r.sendStatus(502); }
});
// ---- launch VLC / mpv on the computer running this app (only for requests coming from that same computer) ----
const os = require('os');
const localIPs = new Set(['127.0.0.1', '::1', ...Object.values(os.networkInterfaces()).flat().map(i => i.address)]);
const PLAYERS = {
  vlc: ['vlc', 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe', '/Applications/VLC.app/Contents/MacOS/VLC'],
  mpv: ['mpv', 'mpv.exe', '/Applications/mpv.app/Contents/MacOS/mpv']
};
app.post('/api/open', (q, r) => {
  const { u, player } = q.query, ip = (q.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (q.get('x-requested-with') !== 'dhakaflix') return r.sendStatus(403); // blocks other websites from triggering this
  if (!localIPs.has(ip)) return r.status(403).json({ error: 'remote' });
  if (!allowed(u) || !PLAYERS[player]) return r.sendStatus(400);
  const paths = [(cfg.players || {})[player], ...PLAYERS[player]].filter(Boolean);
  const attempt = i => {
    if (i >= paths.length) return r.status(501).json({ error: 'notfound' });
    const p = spawn(paths[i], [u], { detached: true, stdio: 'ignore' });
    p.once('error', () => attempt(i + 1)); p.once('spawn', () => { p.unref(); r.json({ ok: true }); });
  };
  attempt(0);
});
// ---- playlist for a title: videos in the folder plus one level of sub-folders (seasons / collections), with matching subtitle files ----
app.get('/api/item', (q, r) => r.json(items.find(i => i.url === q.query.u) || null));
const VIDEO = /\.(mkv|mp4|m4v|avi|webm|mov|ts)$/i, SUBF = /\.(srt|vtt|ass|ssa)$/i, nat = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }), plc = new Map();
const base = n => n.replace(/\.[^.]+$/, '').toLowerCase(), epCode = n => (/s\d+e\d+/i.exec(n) || [''])[0].toLowerCase();
const mapLimit = async (a, n, f) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < a.length) { const k = i++; out[k] = await f(a[k]); } })); return out; };
function mkGroup(name, list) {
  const vids = list.filter(x => !x.dir && VIDEO.test(x.name)).sort(nat), subs = list.filter(x => !x.dir && SUBF.test(x.name));
  return { name, videos: vids.map(v => ({ name: v.name, url: v.url, size: v.size, subs: subs.filter(s => vids.length === 1 || s.name.toLowerCase().startsWith(base(v.name)) || (epCode(v.name) && epCode(s.name) === epCode(v.name))).map(s => ({ name: s.name, url: s.url })) })) };
}
app.get('/api/playlist', async (q, r) => {
  const u = q.query.u; if (!allowed(u)) return r.sendStatus(400);
  try {
    const hit = plc.get(u); if (hit && Date.now() - hit.t < 6e5) return r.json(hit.d);
    const root = await ls(u), dirs = root.filter(x => x.dir).sort(nat);
    const groups = [mkGroup('', root), ...await mapLimit(dirs, 6, async d => mkGroup(d.name, await ls(d.url).catch(() => [])))].filter(g => g.videos.length);
    const d = { groups }; if (plc.size > 200) plc.delete(plc.keys().next().value); plc.set(u, { t: Date.now(), d }); r.json(d);
  } catch (e) { r.status(502).json({ error: e.message }); }
});
app.get('/api/inspect', async (q, r) => { // dry run for one collection: /api/inspect?section=Foreign%20Language
  const s = cfg.sections.find(x => x.name === q.query.section);
  if (!s) return r.status(404).type('text').send('Unknown collection. Use one of:\n' + cfg.sections.map(x => x.name).join('\n'));
  const lines = [], all = [];
  try { await walk(s.url, s, all, 0, (d, t) => lines.push('  '.repeat(d) + t)); } catch (e) { lines.push('ERROR: ' + e.message); }
  const noYear = all.filter(i => !i.year).length;
  r.type('text').send(`${s.name}: ${all.length} titles (${noYear} without a year)\n\nHow the scanner reads this collection:\n${lines.join('\n')}\n\nFirst titles: ${all.slice(0, 8).map(i => i.title + ' (' + (i.year || '?') + ')').join(' | ')}\n`);
});
app.get('/api/m3u', (q, r) => { // opens in VLC / mpv / any player
  if (!allowed(q.query.u)) return r.sendStatus(400);
  const name = (q.query.name || 'video').replace(/[^\w.\- ]+/g, '');
  r.set('Content-Type', 'audio/x-mpegurl'); r.set('Content-Disposition', `attachment; filename="${name}.m3u"`);
  r.send(`#EXTM3U\n#EXTINF:-1,${name}\nhttp://${q.headers.host}/stream?u=${encodeURIComponent(q.query.u)}\n`);
});
app.listen(PORT, '0.0.0.0', () => console.log('DhakaFlix Browser on http://localhost:' + PORT));