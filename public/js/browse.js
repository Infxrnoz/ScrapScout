'use strict';

(() => {
    const FLAG_LABEL = { monthly: 'monthly', weekly: 'weekly', biweekly: 'biweekly', vanilla: 'vanilla', hardcore: 'hardcore', softcore: 'softcore' };
    let offset = 0;
    let selected = null;

    const popBar = s => {
        const pct = s.maxPlayers ? Math.min(100, (s.players / s.maxPlayers) * 100) : 0;
        return `<div class="pop-bar ${s.queued ? 'queue' : ''}"><i style="width:${pct}%"></i></div>`;
    };
    const tags = s => [
        s.region ? `<span class="tag">${esc(s.region)}</span>` : '',
        ...(s.flags || []).map(f => `<span class="tag">${FLAG_LABEL[f] || esc(f)}</span>`),
        s.teamSize ? `<span class="tag">max ${s.teamSize}</span>` : '',
        s.paired ? '<span class="tag green">paired</span>' : ''
    ].join('');
    const spark = pop => {
        if (!pop || pop.length < 2) return '';
        const max = Math.max(...pop.map(p => p[3] || p[1]), 1);
        const pts = pop.map((p, i) => `${(i / (pop.length - 1) * 100).toFixed(1)},${(24 - p[1] / max * 22).toFixed(1)}`).join(' ');
        return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
    };

    function row(s) {
        return `<div class="item server-row ${selected?.id === s.id ? 'sel' : ''}" data-ip="${esc(s.ip)}" data-port="${s.queryPort}">
            <div class="grow"><div class="title">${esc(s.name)}</div>
            <div class="sub">${s.wipe ? `wiped ${ago(s.wipe)}` : 'wipe unknown'} ${tags(s)}</div>${popBar(s)}</div>
            <div class="right"><b class="pop">${s.players}<span>/${s.maxPlayers}</span></b>${s.queued ? `<div class="sub flame">+${s.queued} queue</div>` : ''}</div>
        </div>`;
    }

    const bindRows = root => $$(`${root} .server-row`).forEach(el => el.onclick = () => select(el.dataset.ip, +el.dataset.port));

    let searchSeq = 0;
    async function search(reset = true) {
        const seq = ++searchSeq;
        if (reset) offset = 0;
        const params = new URLSearchParams({
            q: $('#br-q').value, region: $('#br-region').value, flag: $('#br-flag').value,
            minPlayers: $('#br-min').value || 0, sort: $('#br-sort').value, offset
        });
        const out = $('#br-results');
        if (reset) out.innerHTML = '<div class="empty-note">Loading servers…</div>';
        try {
            const r = await api(`/api/browse/list?${params}`);
            if (seq !== searchSeq) return;
            $('#br-key').style.display = 'none';
            $('#br-count').textContent = `${r.total.toLocaleString()} of ${r.count.toLocaleString()} servers · list from ${ago(r.cachedAt)}`;
            const html = r.servers.map(row).join('') || empty('No servers match.');
            $('#br-more')?.remove();
            if (reset) out.innerHTML = html; else out.insertAdjacentHTML('beforeend', html);
            offset += r.servers.length;
            if (offset < r.total) out.insertAdjacentHTML('beforeend', '<button class="btn ghost" id="br-more" style="width:100%">Load more</button>');
            $('#br-more')?.addEventListener('click', () => search(false));
            bindRows('#br-results');
        } catch (e) {
            if (seq !== searchSeq) return;
            out.innerHTML = '';
            $('#br-count').textContent = '';
            $('#br-key').style.display = '';
            $('#br-key-msg').textContent = e.message;
        }
    }

    let debounce;
    ['#br-q', '#br-min'].forEach(s => $(s).oninput = () => { clearTimeout(debounce); debounce = setTimeout(search, 300); });
    ['#br-region', '#br-flag', '#br-sort'].forEach(s => $(s).onchange = () => search());

    $('#br-key-form').onsubmit = async e => {
        e.preventDefault();
        const key = $('#br-key-input').value.trim();
        if (!key) return;
        try {
            await api('/api/settings', { method: 'PUT', body: { steamApiKey: key } });
            $('#br-key-input').value = '';
            search();
        } catch (err) { toast({ kind: 'alarm', label: 'Not saved', text: err.message }); }
    };

    $('#br-lookup').onsubmit = async e => {
        e.preventDefault();
        const addr = $('#br-addr').value.trim();
        if (!addr) return;
        const out = $('#br-lookup-results');
        out.innerHTML = '<div class="empty-note">Asking Steam and the server…</div>';
        try {
            const found = await api(`/api/browse/lookup?addr=${encodeURIComponent(addr)}`);
            out.innerHTML = found.map(row).join('') || empty('No Rust server answered at that address.');
            bindRows('#br-lookup-results');
            if (found.length === 1) select(found[0].ip, found[0].queryPort);
        } catch (err) { out.innerHTML = empty(esc(err.message)); }
    };

    async function renderWatch() {
        let list = [];
        try { list = await api('/api/watch'); } catch {  }
        $('#br-watch-wrap').style.display = list.length ? '' : 'none';
        $('#br-watch').innerHTML = list.map(w => `
            <div class="item server-row ${w.online ? '' : 'dim'}" data-ip="${esc(w.ip)}" data-port="${w.queryPort}">
                <div class="grow"><div class="title">${esc(w.name)}</div>
                <div class="sub">${w.online ? (w.wipe ? `wiped ${ago(w.wipe)}` : '') : 'offline'} ${w.paired ? '<span class="tag green">paired</span>' : ''}</div>${spark(w.pop)}</div>
                <div class="right"><b class="pop">${w.players ?? '–'}<span>/${w.maxPlayers ?? '–'}</span></b>${w.queued ? `<div class="sub flame">+${w.queued}</div>` : ''}</div>
            </div>`).join('');
        bindRows('#br-watch');
    }

    async function select(ip, port) {
        const card = $('#br-detail');
        card.style.display = '';
        card.innerHTML = '<div class="empty-note">Querying server…</div>';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        let d;
        try {
            d = await api(`/api/browse/details?ip=${encodeURIComponent(ip)}&port=${port}`);
        } catch (e) {
            card.innerHTML = empty(`Server didn't answer: ${esc(e.message)}`);
            return;
        }
        selected = d;
        $$('.server-row').forEach(el => el.classList.toggle('sel', el.dataset.ip === ip && +el.dataset.port === port));
        const connect = `${d.ip}:${d.gamePort}`;
        const rustmaps = d.seed && d.size && !d.customMap ? `https://rustmaps.com/map/${d.size}_${d.seed}` : null;
        card.innerHTML = `
            ${d.header ? `<div class="hero" style="background-image:url('${esc(d.header)}')"></div>` : ''}
            <div class="detail-body">
                <div class="title big">${esc(d.name)}</div>
                <div class="sub">${tags(d)}</div>
                <div class="stat-row">
                    <div><b>${d.players}<small>/${d.maxPlayers}</small></b><span>players${d.queued ? ` +${d.queued}` : ''}</span></div>
                    <div><b>${d.wipe ? dur(Date.now() - d.wipe).split(' ')[0] : '?'}</b><span>since wipe</span></div>
                    <div><b>${d.size ?? '?'}</b><span>map size</span></div>
                    <div><b>${d.fps ?? '?'}</b><span>server fps</span></div>
                </div>
                ${spark(d.pop)}
                <div class="kv"><span>Seed</span><b>${d.seed ?? '?'}</b><span>Map</span><b>${esc(d.map)}${d.customMap ? ' (custom)' : ''}</b>
                <span>Entities</span><b>${d.entities ? d.entities.toLocaleString() : '?'}</b><span>Uptime</span><b>${d.uptime ? dur(d.uptime * 1000) : '?'}</b>
                <span>Connect</span><b class="copy" title="Click to copy">client.connect ${esc(connect)}</b></div>
                <div class="btn-row">
                    ${d.mapImage ? '<button class="btn" id="br-preview">View map</button>' : ''}
                    ${d.paired ? '<button class="btn" id="br-live">Open live (paired)</button>' : ''}
                    <a class="btn ghost" href="steam://connect/${esc(connect)}">Join in Rust</a>
                    <button class="btn ghost" id="br-watch-btn">${d.watched ? '★ Watching' : '☆ Watch'}</button>
                    ${rustmaps ? `<a class="btn ghost" href="${rustmaps}" target="_blank" rel="noopener">RustMaps</a>` : ''}
                    ${d.url ? `<a class="btn ghost" href="${esc(d.url)}" target="_blank" rel="noopener">Website</a>` : ''}
                </div>
                ${d.paired ? '' : `<p class="hint">Not paired: you get the map, pop and wipe info. For shops, team, events and devices, join the server and do <b>ESC → Rust+ → Pair with server</b> — it switches to live here automatically.</p>`}
                ${d.description ? `<details class="desc"><summary>Server description</summary><pre>${esc(d.description)}</pre></details>` : ''}
            </div>`;

        $('.kv .copy').onclick = () => navigator.clipboard?.writeText(`client.connect ${connect}`).then(() => toast({ kind: 'teamOnline', label: 'Copied', text: 'Paste it into the F1 console' }));
        $('#br-preview')?.addEventListener('click', () => showPreview(d));
        $('#br-live')?.addEventListener('click', async () => {
            showLive();
            if (S.servers?.active !== d.paired) await api(`/api/servers/${encodeURIComponent(d.paired)}/activate`, { method: 'POST' }).catch(() => {});
        });
        $('#br-watch-btn').onclick = async () => {
            if (d.watched) await api(`/api/watch/${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => {});
            else await api('/api/watch', { method: 'POST', body: { ip: d.ip, queryPort: d.queryPort } }).catch(e => toast({ kind: 'alarm', label: 'Watch failed', text: e.message }));
            renderWatch();
            select(d.ip, d.queryPort);
        };
        if (d.mapImage && !d.paired) showPreview(d);
    }

    function showPreview(d) {
        S.preview = d;
        const meta = (w, h) => ({
            imageUrl: d.mapImage, width: w, height: h, oceanMargin: 500 * w / 3000,
            mapSize: d.size || 4000, monuments: [], version: d.id, seed: d.seed, custom: d.customMap, rustMapsId: d.rustMapsId, levelUrl: d.levelUrl
        });
        loadMap(meta(3000, 3000));
        const img = new Image();
        img.onload = () => {
            if (S.preview !== d || (img.naturalWidth === 3000 && img.naturalHeight === 3000)) return;
            loadMap(meta(img.naturalWidth, img.naturalHeight));
        };
        img.src = d.mapImage;
        $('#preview-banner').innerHTML = d.fallback
            ? `<div><b>Rust+ isn't answering</b> ${esc(d.name)} <span class="muted">· showing its map from Steam · live markers come back by themselves once Rust+ answers</span></div>
            <button class="btn small" id="preview-exit">Hide</button>`
            : `<div><b>Previewing</b> ${esc(d.name)} <span class="muted">· ${d.players}/${d.maxPlayers} · ${d.paired ? 'paired — open live for shops, team and events' : 'map only, not paired'}</span></div>
            <button class="btn small" id="preview-exit">${S.snapshot ? 'Back to live server' : 'Close preview'}</button>`;
        $('#preview-banner').classList.add('on');
        $('#preview-exit').onclick = showLive;
    }

    function showLive() {
        S.preview = null;
        $('#preview-banner').classList.remove('on');
        loadMap(S.snapshot?.mapMeta ?? null);
    }

    async function openMapFile(file) {
        if (!/\.map$/i.test(file.name)) return toast({ kind: 'alarm', label: 'Not a map file', text: 'Pick a Rust .map file (servers publish them; RustMaps lets you download them).' });
        toast({ kind: 'teamOnline', label: 'Opening map', text: `Reading ${file.name} (${Math.round(file.size / 1048576)} MB)…` });
        try {
            const res = await fetch('/api/mapfile', {
                method: 'POST', body: file,
                headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }
            });
            const meta = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(meta.error || `HTTP ${res.status}`);
            showMapFile(meta);
            renderMapFiles();
        } catch (e) {
            toast({ kind: 'alarm', label: 'Couldn’t open map', text: e.message });
        }
    }

    function showMapFile(meta) {
        S.preview = { mapFile: meta.id, name: meta.name };
        loadMap({
            imageUrl: `/api/mapfile/${meta.id}/preview.png`, width: 2048, height: 2048, oceanMargin: 0, mapSize: meta.size,
            monuments: meta.monuments, version: meta.id, custom: true, levelUrl: meta.key, seed: null, mapFile: true
        });
        const named = meta.monuments.filter(m => !/^(Cave|Water Well)$/.test(m.name)).length;
        $('#preview-banner').innerHTML = `<div><b>Map file</b> ${esc(meta.name)} <span class="muted">· ${meta.size} m · ${named} monuments · ${meta.facilities} facility pins · open <b>Resource filters</b> for ores, recyclers and cards</span></div>
            <div class="row"><a class="btn ghost small" href="/api/mapfile/${meta.id}/preview.png" download="${esc(meta.name)}.png">Save image</a>
            <button class="btn small" id="preview-exit">${S.snapshot ? 'Back to live server' : 'Close'}</button></div>`;
        $('#preview-banner').classList.add('on');
        $('#preview-exit').onclick = showLive;
    }

    async function renderMapFiles() {
        const files = await api('/api/mapfiles').catch(() => []);
        $('#mf-list').innerHTML = files.map(f => `<div class="item flat">
                <div class="grow"><div class="title">${esc(f.name)}</div>
                <div class="sub">${f.size} m · ${f.monumentCount} monuments · opened ${ago(f.opened)}</div></div>
                <button class="btn ghost small" data-mf-open="${f.id}">Open</button>
                <button class="icon-btn" data-mf-del="${f.id}" title="Forget">✕</button></div>`).join('');
        $$('#mf-list [data-mf-open]').forEach(b => b.onclick = async () => {
            try { showMapFile(await api(`/api/mapfile/${b.dataset.mfOpen}`)); } catch (e) { toast({ kind: 'alarm', label: 'Couldn’t open map', text: e.message }); }
        });
        $$('#mf-list [data-mf-del]').forEach(b => b.onclick = async () => {
            if (S.preview?.mapFile === b.dataset.mfDel) showLive();
            await api(`/api/mapfile/${b.dataset.mfDel}`, { method: 'DELETE' }).catch(() => {});
            renderMapFiles();
        });
    }

    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.map', hidden: true });
    document.body.appendChild(picker);
    picker.onchange = () => { const f = picker.files[0]; picker.value = ''; if (f) openMapFile(f); };
    $('#mf-open').onclick = () => picker.click();
    document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
    document.addEventListener('drop', e => {
        const f = [...(e.dataTransfer?.files || [])].find(x => /\.map$/i.test(x.name));
        if (!f) return;
        e.preventDefault();
        openTab('browse');
        openMapFile(f);
    });

    bus.on('tab:browse', () => {
        renderMapFiles();
        renderWatch();
        if (!$('#br-results').children.length) search();
    });
    function showFallback() {
        const f = S.snapshot?.fallback;
        if (!f || S.snapshot.mapMeta || (S.preview && !S.preview.fallback)) return;
        showPreview({ ...f, fallback: true });
    }
    bus.on('fallback', showFallback);
    bus.on('watch', renderWatch);
    bus.on('reset', () => {
        showFallback();
        if (!S.preview || !S.snapshot || S.preview.fallback) return;
        const live = S.servers?.list.find(s => s.id === S.snapshot.server.id);
        if (live?.ip === S.preview.ip) showLive();
    });
})();
