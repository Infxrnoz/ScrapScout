'use strict';

(() => {

    const TOOL_ORDER = ['rocket', 'c4', 'satchel', 'explo', 'beancan', 'hv', 'f1'];
    const DEFAULT_TOOLS = ['rocket', 'c4', 'satchel', 'explo', 'beancan'];
    const META_PREF = {
        block: ['rocket', 'c4', 'satchel', 'explo', 'beancan', 'hv', 'f1'],
        armored: ['c4', 'rocket', 'satchel', 'explo', 'beancan', 'hv', 'f1'],
        door: ['c4', 'rocket', 'satchel', 'explo', 'beancan', 'hv', 'f1'],
        soft: ['explo', 'satchel', 'c4', 'rocket', 'beancan', 'hv', 'f1']
    };
    const STYLE_HINT = {
        meta: 'What raiders actually bring — rockets open walls from range (safer than running up), C4 breaches doors & armored, explo cleans up windows and deployables.',
        cheapest: 'Lowest sulfur per target from the tools you allow. Satchels and explo are cheap but slow and loud.'
    };
    const TIER_COLOR = { Wooden: '#8a5a2b', Stone: '#8d8a85', Sheet: '#6b7784', Armored: '#3f4a55', High: '#6b5a44' };

    const saved = store.get('raid', {});
    const raid = {
        style: saved.style || 'meta',
        tools: new Set(Array.isArray(saved.tools) ? saved.tools : DEFAULT_TOOLS),
        counts: saved.counts || {}
    };
    const saveRaid = () => store.set('raid', { style: raid.style, tools: [...raid.tools], counts: raid.counts });

    const prefFor = t => t.armored ? META_PREF.armored
        : t.category === 'Building' || t.category === 'External Walls' ? META_PREF.block
        : t.category === 'Windows' || t.category === 'Deployables' ? META_PREF.soft
        : META_PREF.door;

    function pickTool(target) {
        const allowed = Object.keys(target.costs).filter(k => raid.tools.has(k));
        if (!allowed.length) return null;
        if (raid.style === 'cheapest') {
            const cost = k => target.costs[k].qty * S.raid.tools[k].sulfur;
            return allowed.reduce((best, k) => cost(k) < cost(best) ? k : best);
        }
        return prefFor(target).find(k => allowed.includes(k));
    }

    function renderRaidUI() {
        if (!S.raid) return;
        $$('#raid-style button').forEach(b => b.classList.toggle('active', b.dataset.style === raid.style));
        $('#raid-style-hint').textContent = STYLE_HINT[raid.style];

        $('#tool-list').innerHTML = TOOL_ORDER.map(k => `
            <label class="check"><input type="checkbox" value="${k}" ${raid.tools.has(k) ? 'checked' : ''}>
            ${icon(S.raid.tools[k].id)} ${esc(S.raid.tools[k].name)} <span class="muted">${S.raid.tools[k].sulfur} sulfur</span></label>`).join('');
        $('#tool-list').querySelectorAll('input').forEach(cb => cb.onchange = () => {
            cb.checked ? raid.tools.add(cb.value) : raid.tools.delete(cb.value);
            saveRaid();
            renderRaidUI();
        });
        $('#tool-summary').textContent = raid.tools.size === TOOL_ORDER.length ? 'All tools' : `${raid.tools.size} tools`;

        const byCat = {};
        for (const t of S.raid.targets) (byCat[t.category] ??= []).push(t);
        $('#raid-targets').innerHTML = Object.entries(byCat).map(([cat, targets]) => `
            <div class="raid-cat">${esc(cat)}</div>
            <div class="raid-grid">${targets.map(t => {
                const n = raid.counts[t.key] || 0;
                const tier = Object.keys(TIER_COLOR).find(k => t.name.startsWith(k));
                const pic = t.shortname
                    ? `<img src="https://rustlabs.com/img/items180/${t.shortname}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
                    : `<div class="ph" style="background:${TIER_COLOR[tier] || '#444'}">${esc(t.name.split(' ').pop()[0])}</div>`;
                return `<div class="tile ${n ? 'on' : ''}" data-k="${t.key}">${pic}<div class="name">${esc(t.name)}</div>
                    <div class="ctl"><button data-d="-1">−</button><span class="count">${n}</span><button data-d="1">+</button></div></div>`;
            }).join('')}</div>`).join('');
        $('#raid-targets').querySelectorAll('.tile').forEach(tile => {
            const bump = d => {
                const k = tile.dataset.k;
                raid.counts[k] = Math.max(0, (raid.counts[k] || 0) + d);
                if (!raid.counts[k]) delete raid.counts[k];
                saveRaid();
                renderRaidUI();
            };
            tile.querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); bump(Number(b.dataset.d)); });
            tile.onclick = () => bump(1);
            tile.oncontextmenu = e => { e.preventDefault(); bump(-1); };
        });
        renderRaidResult();
    }

    function renderRaidResult() {
        const lines = [];
        const totals = {};
        let sulfur = 0, seconds = 0;
        const blocked = [];
        for (const t of S.raid.targets) {
            const n = raid.counts[t.key];
            if (!n) continue;
            const tool = pickTool(t);
            if (!tool) { blocked.push(t.name); continue; }
            const qty = t.costs[tool].qty * n;
            const s = qty * S.raid.tools[tool].sulfur;
            totals[tool] = (totals[tool] || 0) + qty;
            sulfur += s;
            seconds += (t.costs[tool].time || 0) * n;
            lines.push(`<tr><td>${n}× ${esc(t.name)}</td><td>${icon(S.raid.tools[tool].id)} ${qty}× ${esc(S.raid.tools[tool].name)}</td><td>${fmt(s)}</td></tr>`);
        }
        if (!lines.length && !blocked.length) {
            $('#raid-result').innerHTML = empty('Click a tile to add it (right-click removes).');
            return;
        }
        $('#raid-result').innerHTML = `
            <div class="total"><div><span>Total sulfur</span><b>${sulfur.toLocaleString()}</b></div>
                <div class="sub-totals"><span>${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s to break</span></div></div>
            <div class="list" style="margin-bottom:8px">${Object.entries(totals).map(([k, q]) => `
                <div class="item flat">${icon(S.raid.tools[k].id, 'icon')}<div class="grow">${q}× ${esc(S.raid.tools[k].name)}</div>
                <span class="muted">${fmt(q * S.raid.tools[k].sulfur)} sulfur</span></div>`).join('')}</div>
            <table class="breakdown">${lines.join('')}</table>
            ${blocked.length ? `<p class="hint flame">No allowed tool breaks: ${blocked.map(esc).join(', ')}</p>` : ''}
            <div class="row" style="margin-top:8px"><button class="btn ghost" id="raid-clear">Clear</button>
            <button class="btn ghost" id="raid-share">Send to team chat</button></div>`;
        $('#raid-clear').onclick = () => { raid.counts = {}; saveRaid(); renderRaidUI(); };
        $('#raid-share').onclick = async () => {
            const parts = Object.entries(totals).map(([k, q]) => `${q} ${S.raid.tools[k].name.replace('Timed Explosive Charge', 'C4').replace('Explosive 5.56 Rifle Ammo', 'explo')}`);
            try {
                await api('/api/chat', { method: 'POST', body: { message: `Raid needs ${parts.join(', ')} = ${sulfur} sulfur` } });
                toast({ kind: 'chat', label: 'Sent', text: 'Raid cost posted to team chat' });
            } catch (e) { toast({ kind: 'alarm', label: 'Could not send', text: e.message }); }
        };
    }

    $$('#raid-style button').forEach(b => b.onclick = () => { raid.style = b.dataset.style; saveRaid(); renderRaidUI(); });
    bus.on('ready', renderRaidUI);
})();
