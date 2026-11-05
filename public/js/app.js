    const $ = s => document.querySelector(s), enc = encodeURIComponent; let st = { type: '', section: '', year: '', sort: '', q: '', offset: 0 }, secs = [], lastY = null;
    const h = (t, p = {}, ...k) => { const e = Object.assign(document.createElement(t), p); e.append(...k); return e };
    const ic = n => `<svg class="ic"><use href="#i-${n}"/></svg>`;
    const size = s => { const m = /([\d.]+)\s*(KB|MB|GB)/i.exec(s); if (!m) return s; const kb = +m[1] * { KB: 1, MB: 1024, GB: 1048576 }[m[2].toUpperCase()]; return kb >= 1048576 ? (kb / 1048576).toFixed(2) + ' GB' : Math.round(kb / 1024) + ' MB' };
    let seq = 0;
    async function load(reset) {
      const my = ++seq; if (reset) st.offset = 0; let d;
      try { const r = await fetch('/api/items?' + new URLSearchParams({ ...st, limit: 60 })); if (!r.ok) throw new Error('error ' + r.status); d = await r.json() }
      catch (e) { if (my === seq) { $('#empty').hidden = false; $('#empty').textContent = 'Search failed (' + e.message + '). See the terminal where the app is running.' } return }
      if (my !== seq) return; if (reset) { $('#grid').replaceChildren(); lastY = null }
      for (const it of d.items) {
        if ((st.sort === 'year' || st.sort === 'yearAsc') && it.year !== lastY) { lastY = it.year; $('#grid').append(h('h3', { className: 'yh' }, it.year || 'Year unknown')) } known[it.url] = it; const c = h('button', { className: 'card', title: it.title }, thumb(it), h('div', { className: 't' }, h('b', {}, it.title), h('i', {}, [it.year, it.quality].filter(Boolean).join(' / '))));
        if (it.type === 'series') c.firstChild.append(h('span', { className: 'badge' }, 'Series')); c.onclick = () => go(it.url); $('#grid').append(c)
      }
      st.offset += d.items.length; $('#more').hidden = st.offset >= d.total; $('#count').textContent = d.total.toLocaleString() + ' titles'; $('#ht').textContent = (st.q ? `Results for “${st.q}”` : st.section || ({ movie: 'Movies', series: 'Series' }[st.type]) || 'Recently added') + (st.year ? ` · ${st.year}` : '');
      const e = $('#empty'); e.hidden = d.total > 0; if (!d.total) {
        const s = await (await fetch('/api/status')).json();
        e.textContent = s.crawling ? 'Scanning the servers for the first time. This takes a few minutes. Refresh to see titles as they appear.' : s.total ? 'No titles match. Try fewer letters.' : 'The library is empty. Check that this machine can reach the servers, then press Rescan library.'
      }
    }
    const openNav = () => { $('#nav').classList.add('open'); $('#scrim').hidden = false }, closeNav = () => { $('#nav').classList.remove('open'); $('#scrim').hidden = true };
    $('#menu').onclick = openNav; $('#scrim').onclick = closeNav;
    function fillSections() {
      const S = $('#secs'); S.replaceChildren();
      secs.filter(x => !st.type || x.type === st.type).forEach(x => {
        const b = h('button', {
          type: 'button', className: 'ni sm' + (st.section === x.name ? ' on' : ''), innerHTML: ic(x.type === 'series' ? 'tv' : 'film') + '<span class="lbl"></span><small></small>',
          onclick: () => { toHome(); st.year = ''; st.section = st.section === x.name ? '' : x.name; fillSections(); load(true); closeNav() }
        });
        b.querySelector('.lbl').textContent = x.name; b.querySelector('small').textContent = x.count.toLocaleString(); S.append(b)
      }); loadYears()
    }
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); toHome(); st.year = ''; st.type = b.dataset.t; st.section = ''; fillSections(); load(true); closeNav() });
    $('#more').onclick = () => load();
    async function loadYears() { // year filter chips for the current type / collection
      const y = await fetch('/api/years?' + new URLSearchParams({ type: st.type, section: st.section })).then(r => r.json()).catch(() => []), Y = $('#years'); Y.replaceChildren(); if (!y.length) return;
      [{ year: '', count: y.reduce((n, x) => n + x.count, 0) }, ...y].forEach(x => {
        const b = h('button', { type: 'button', className: 'chip' + (st.year === x.year ? ' on' : ''), innerHTML: '<span></span><small></small>', onclick: () => { st.year = x.year; loadYears(); load(true) } });
        b.firstChild.textContent = x.year || 'All years'; b.lastChild.textContent = x.count.toLocaleString(); Y.append(b)
      })
    }
    $('#sort').onchange = e => { st.sort = e.target.value; load(true) };
    let wasCrawling = false, pt;
    async function poll() { // shows a notice while the server is scanning, and refreshes the page when it finishes
      const r = await fetch('/api/status').then(r => r.json()).catch(() => null); if (!r) return; clearTimeout(pt);
      $('#scan').hidden = !r.crawling; $('#scan').textContent = 'Scanning the library in the background...';
      if (r.crawling) pt = setTimeout(poll, 3000); else if (wasCrawling) { secs = await fetch('/api/sections').then(r => r.json()); fillSections(); load(true) }
      wasCrawling = r.crawling
    }
    const syncTheme = () => { const d = document.documentElement.dataset.theme === 'dark'; $('#theme').innerHTML = ic(d ? 'sun' : 'moon') + `<span class="lbl">${d ? 'Light mode' : 'Dark mode'}</span>` };
    $('#theme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('dfTheme', t) } catch { } syncTheme() }; syncTheme();
    let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { toHome(); st.q = e.target.value; load(true) }, 250) };
    $('#rescan').onclick = async () => { await fetch('/api/crawl', { method: 'POST' }); poll() };
    // ---- watch page (YouTube style): player + playlist sidebar ----
    let cur = null, pls = [], pi = -1, show = null, wtok = 0; const known = {}, home = $('#home'), wv = $('#wv'), v = $('#v'), pl = $('#pl'), sk = $('#seek'), msg = t => $('#msg').textContent = t;
    const lsGet = k => { try { return localStorage.getItem(k) } catch { return null } }, lsSet = (k, x) => { try { localStorage.setItem(k, x) } catch { } };
    const fmt = s => { s = Math.floor(s); const H = Math.floor(s / 3600), M = Math.floor(s % 3600 / 60), S = String(s % 60).padStart(2, '0'); return H ? `${H}:${String(M).padStart(2, '0')}:${S}` : `${M}:${S}` };
    const now = () => cur.offset + v.currentTime;
    const stop = () => { v.pause(); v.removeAttribute('src'); v.load(); pl.hidden = true; $('#seekrow').hidden = true; cur = null };
    const thumb = it => h('div', { className: 'th' }, h('div', { className: 'ph' }, it.title[0] || '?'), Object.assign(h('img', { loading: 'lazy', alt: '', src: '/api/poster?u=' + enc(it.url) }), { onerror() { this.remove() } }));
    const go = (u, vu) => { location.hash = 'w=' + enc(u) + (vu ? '&v=' + enc(vu) : '') }, toHome = () => { if (location.hash.length > 1) location.hash = '' };
    function route() {
      const q = new URLSearchParams(location.hash.slice(1)), u = q.get('w'); stop(); wtok++; closeNav();
      if (!u) { wv.hidden = true; home.hidden = false; document.title = 'DhakaFlix Browser'; return }
      home.hidden = true; wv.hidden = false; window.scrollTo(0, 0); openWatch(u, q.get('v'));
    }
    addEventListener('hashchange', route);
    async function openWatch(u, vu) {
      const my = ++wtok; show = null; pls = []; pi = -1; $('#plbox').hidden = true; $('#ep').textContent = ''; $('#dtags').replaceChildren(); $('#dt').textContent = 'Loading...'; $('#rel').replaceChildren();
      const it = known[u] || await fetch('/api/item?u=' + enc(u)).then(r => r.json()).catch(() => null) || { url: u, title: decodeURIComponent(u.split('/').filter(Boolean).pop()), year: '', quality: '', section: '', type: 'movie' };
      if (my !== wtok) return; show = it; document.title = it.title + ' - DhakaFlix Browser';
      $('#dt').textContent = it.title + (it.year ? ` (${it.year})` : '');
      $('#dtags').replaceChildren(...[it.type === 'series' && 'Series', it.quality, it.dual && 'Dual audio', it.section].filter(Boolean).map(t => h('span', { className: 'tag' }, t)));
      related(it, my);
      const d = await fetch('/api/playlist?u=' + enc(u)).then(r => r.json()).catch(() => null);
      if (my !== wtok) return;
      if (!d || !d.groups || !d.groups.length) { pl.hidden = false; msg('No video files found here, or the server could not be reached.'); return }
      d.groups.forEach(g => g.videos.forEach(x => pls.push(x))); renderList(d.groups);
      $('#plbox').hidden = pls.length < 2; $('#plc').textContent = pls.length + ' videos';
      const want = vu || lsGet('dfl:' + u), i = pls.findIndex(x => x.url === want); playIdx(Math.max(0, i));
    }
    function renderList(groups) {
      const L = $('#plist'); L.replaceChildren(); let n = 0;
      groups.forEach(g => {
        if (groups.length > 1 && g.name) L.append(h('div', { className: 'gh' }, g.name));
        g.videos.forEach(x => {
          const i = n++, e = /S(\d+)E(\d+)/i.exec(x.name), q = (/2160p|1080p|720p|480p/i.exec(x.name) || [''])[0];
          L.append(h('button', { className: 'pi', onclick: () => playIdx(i) }, h('span', { className: 'no' }, String(i + 1)),
            h('span', { className: 'tx' }, h('b', {}, e ? `Episode ${+e[2]}` : x.name.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')), h('small', {}, [e && `S${+e[1]}`, q, size(x.size)].filter(Boolean).join(' / ')))))
        })
      });
    }
    function playIdx(i) {
      if (i < 0 || i >= pls.length) return; pi = i; const x = pls[i], e = /S(\d+)E(\d+)/i.exec(x.name), L = $('#plist'), on = document.querySelectorAll('.pi');
      on.forEach((b, j) => b.classList.toggle('on', j === i)); if (on[i]) L.scrollTop = on[i].offsetTop - L.clientHeight / 3;
      $('#ep').textContent = pls.length > 1 && e ? `Season ${+e[1]}, Episode ${+e[2]}` : x.name;
      history.replaceState(null, '', '#w=' + enc(show.url) + '&v=' + enc(x.url)); lsSet('dfl:' + show.url, x.url);
      $('#prev').disabled = i === 0; $('#next').disabled = i === pls.length - 1;
      $('#dl').href = '/stream?u=' + enc(x.url) + '&dl=1'; $('#m3u').href = `/api/m3u?u=${enc(x.url)}&name=${enc(x.name.replace(/\.[^.]+$/, ''))}`;
      start(x, x.subs);
    }
    async function related(it, my) {
      const d = await fetch('/api/items?' + new URLSearchParams({ section: it.section || '', type: it.type || '', limit: 16 })).then(r => r.json()).catch(() => null);
      if (!d || my !== wtok) return; const R = $('#rel'); R.replaceChildren();
      d.items.filter(x => x.url !== it.url).slice(0, 12).forEach(x => { known[x.url] = x; R.append(h('button', { className: 'rl', onclick: () => go(x.url) }, thumb(x), h('span', { className: 'tx' }, h('b', {}, x.title), h('small', {}, [x.year, x.quality].filter(Boolean).join(' / '))))) });
    }
    $('#prev').onclick = () => playIdx(pi - 1); $('#next').onclick = () => playIdx(pi + 1);
    $('#ovlc').onclick = e => pls[pi] && openExt(pls[pi].url, 'vlc', e.currentTarget); $('#ompv').onclick = e => pls[pi] && openExt(pls[pi].url, 'mpv', e.currentTarget);
    $('#cp').onclick = e => { if (!pls[pi]) return; navigator.clipboard.writeText(location.origin + '/stream?u=' + enc(pls[pi].url)); const sp = e.currentTarget.querySelector('span'); sp.textContent = 'Copied'; setTimeout(() => sp.textContent = 'Copy link', 1500) };
    v.onended = () => { if (cur) lsSet('dfp:' + cur.url, 0); if ($('#auto').checked && pi < pls.length - 1) playIdx(pi + 1) };
    setInterval(() => { if (cur && !v.paused && now() > 5) lsSet('dfp:' + cur.url, Math.floor(now())) }, 5000);
    async function openExt(url, player, btn) { // asks the app to launch the player on the computer it runs on
      const sp = btn.querySelector('span') || btn, label = sp.textContent;
      try {
        const r = await fetch(`/api/open?player=${player}&u=${enc(url)}`, { method: 'POST', headers: { 'X-Requested-With': 'dhakaflix' } });
        if (r.ok) { sp.textContent = 'Opening...'; setTimeout(() => sp.textContent = label, 2500); msg(''); return }
        const e = await r.json().catch(() => ({}));
        msg(e.error === 'remote' ? 'This device is not the computer running the app, so it cannot start a player here. Use "Playlist (.m3u)" and open that file in your player.'
          : e.error === 'notfound' ? `Could not find ${player} on the computer running the app. Install it, or set its path under "players" in config.json.` : 'Could not start the player.')
      } catch { msg('Could not reach the app.') }
    }
    const OKV = /^(h264|vp8|vp9|av1)$/, OKA = /^(aac|mp3|opus|vorbis)$/, OKC = /\.(mp4|m4v|mov|webm)$/i;
    async function start(x, ext) { // plays directly when the browser can handle the file, otherwise the server converts what is needed
      const c = cur = { url: x.url, mode: 'direct', offset: 0, dur: 0, a: 0, sub: '', ext, info: null };
      $('#cv').checked = false; pl.hidden = false; msg('Preparing...'); fillTracks(); pl.scrollIntoView({ block: 'nearest' });
      const info = await fetch('/api/probe?u=' + enc(x.url)).then(r => r.ok ? r.json() : null).catch(() => null);
      if (cur !== c) return; c.info = info; msg('');
      if (info) {
        c.dur = info.duration; const a = info.audio[0];
        if (!(OKC.test(x.name) && OKV.test(info.video) && (!a || OKA.test(a.codec)))) { c.mode = 'audio'; $('#cv').checked = info.video !== 'h264' }
      }
      else msg('Could not read the track list (is ffprobe installed?). Playing the file directly.');
      fillTracks(); const t = +lsGet('dfp:' + x.url) || 0; playAt(t > 15 && (!c.dur || t < c.dur - 60) ? t : 0);
    }
    let wd; function watch() { // if a file plays but no sound is decoded, switch to the server-converted stream
      clearTimeout(wd); const c = cur, m = c.mode;
      wd = setTimeout(() => {
        if (cur !== c || c.mode !== m || v.paused || v.muted || v.volume === 0 || v.currentTime < 1 || !(c.info && c.info.audio.length)) return;
        if (!(v.mozHasAudio === false || v.webkitAudioDecodedByteCount === 0)) return;
        if (m === 'direct') { c.mode = 'audio'; $('#cv').checked = c.info.video !== 'h264'; msg("This browser cannot decode this file's audio, so it was switched to compatible mode."); playAt(now()) }
        else msg('No audio is reaching the browser. Check that the tab is not muted, or use Open in VLC / mpv.')
      }, 3500)
    }
    function fillTracks() {
      const i = cur.info, lab = s => [s.lang || 'und', s.title, s.codec, s.channels ? s.channels + 'ch' : ''].filter(Boolean).join(' / ');
      $('#aud').replaceChildren(...(i && i.audio.length ? i.audio.map(s => h('option', { value: s.i }, lab(s))) : [h('option', { value: 0 }, i ? 'Default' : 'Reading tracks...')])); $('#aud').value = cur.a; $('#aud').disabled = !(i && i.audio.length > 1);
      const o = [h('option', { value: '' }, 'Off')]; cur.ext.forEach(f => o.push(h('option', { value: 'f:' + f.url }, 'File: ' + f.name)));
      if (i) i.subs.forEach(s => o.push(h('option', { value: 'e:' + s.i, disabled: !s.text }, lab(s) + (s.text ? '' : ' (image-based, use VLC / mpv)'))));
      $('#sub').replaceChildren(...o); $('#sub').value = cur.sub;
    }
    function playAt(at) {
      const c = cur, direct = c.mode === 'direct'; c.offset = direct ? 0 : Math.floor(at);
      v.src = direct ? '/stream?u=' + enc(c.url) : `/transcode?mode=${$('#cv').checked ? 'full' : 'audio'}&a=${c.a}&t=${c.offset}&u=${enc(c.url)}`;
      if (direct && at > 1) v.addEventListener('loadedmetadata', () => { v.currentTime = at }, { once: true });
      const bar = !direct && c.dur; $('#seekrow').hidden = !bar; v.controls = !bar; sk.max = c.dur; applySub(); watch(); v.play().catch(() => { });
    }
    function applySub() {
      v.querySelectorAll('track').forEach(t => t.remove()); const s = cur.sub; if (!s) return;
      const u = s.startsWith('f:') ? `/api/sub?file=1&u=${enc(s.slice(2))}` : `/api/sub?s=${s.slice(2)}&u=${enc(cur.url)}`;
      const t = h('track', { kind: 'subtitles', label: 'Subtitles', default: true, src: `${u}&shift=${cur.offset}` });
      msg('Loading subtitles. The first time can take a minute for a large file.');
      t.onload = () => msg(''); t.onerror = () => msg('Could not load these subtitles. They may be image-based, or ffmpeg is missing.');
      v.append(t); t.track.mode = 'showing';
    }
    const reload = () => playAt(now());
    $('#aud').onchange = e => { cur.a = +e.target.value; if (cur.mode === 'direct') cur.mode = 'audio'; reload() };
    $('#cv').onchange = () => { if (cur.mode === 'direct') cur.mode = 'audio'; reload() };
    $('#sub').onchange = e => { cur.sub = e.target.value; applySub() };
    sk.oninput = () => $('#tm').textContent = fmt(+sk.value); sk.onchange = () => playAt(+sk.value);
    v.ontimeupdate = () => { if (cur && !$('#seekrow').hidden && document.activeElement !== sk) { sk.value = now(); $('#tm').textContent = fmt(now()) + ' / ' + fmt(cur.dur) } };
    v.onerror = () => {
      if (!v.getAttribute('src') || !cur) return;
      if (cur.mode === 'direct' && cur.info) { cur.mode = 'audio'; $('#cv').checked = cur.info.video !== 'h264'; msg('This browser cannot play the file directly. Switched to compatible mode.'); playAt(now()); return }
      msg(cur.mode === 'direct' ? 'This browser cannot play this file. Open it in VLC / mpv instead.' : 'Conversion failed. Check that ffmpeg is installed. If the picture is missing, tick "Convert video".')
    };
    const pp = $('#pp'); pp.onclick = () => v.paused ? v.play() : v.pause(); v.onplay = v.onpause = () => pp.innerHTML = ic(v.paused ? 'play' : 'pause');
    $('#mu').onclick = () => { v.muted = !v.muted; $('#mu').innerHTML = ic(v.muted ? 'mute' : 'vol') };
    $('#vol').oninput = e => { v.volume = +e.target.value; v.muted = false; $('#mu').innerHTML = ic('vol') };
    $('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('#stage').requestFullscreen();
    fetch('/api/sections').then(r => r.json()).then(s => { secs = s; fillSections() }); load(true); route(); poll();
