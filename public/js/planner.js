'use strict';

(() => {
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const when = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

    function renderWipe() {
        const el = $('#wipe-card');
        if (!S.info) { el.innerHTML = ''; return; }
        const last = S.info.wipeTime ? S.info.wipeTime * 1000 : null;
        const flags = S.snapshot?.mapMeta?.flags || [];
        const next = nextServerWipe(last, flags);
        const forced = nextForcedWipe();
        const schedule = flags.includes('weekly') ? 'weekly' : flags.includes('biweekly') ? 'every 2 weeks' : flags.includes('monthly') ? 'monthly' : null;
        el.innerHTML = `<div class="row-between"><h3>Wipe</h3>${schedule ? `<span class="tag">wipes ${schedule}</span>` : ''}</div>
            <div class="wipe-next"><b>${dur(next.at - Date.now())}</b><span>until the next ${next.forced ? 'forced wipe' : 'wipe'} · ${when(next.at)}</span></div>
            <div class="kv"><span>Last wipe</span><b>${last ? `${ago(last)} · ${when(last)}` : 'unknown'}</b>
            ${next.forced ? '' : `<span>Forced wipe</span><b>${when(forced)}</b>`}</div>
            ${next.forced ? '<p class="hint">Forced wipes hit every server on the first Thursday of the month at 2 PM US Eastern time.</p>' : '<p class="hint">Next wipe estimated from this server\'s schedule. Forced wipes hit every server on the first Thursday of the month.</p>'}`;
    }

    function renderRaidTime() {
        const grid = $('#raidtime-grid');
        if (!grid) return;
        const sum = DAYS.map(() => Array(24).fill(0)), n = DAYS.map(() => Array(24).fill(0)), dates = new Set();
        for (const [t, players] of S.pop || []) {
            const d = new Date(t), day = (d.getDay() + 6) % 7;
            sum[day][d.getHours()] += players;
            n[day][d.getHours()]++;
            dates.add(d.toDateString());
        }
        const cells = [];
        for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (n[d][h] >= 3) cells.push({ d, h, avg: sum[d][h] / n[d][h] });
        if (!cells.length) {
            grid.innerHTML = '';
            $('#raidtime-best').textContent = '';
            $('#raidtime-note').textContent = 'No player counts yet. ScrapScout records them while it\'s connected; check back after it has been open for a while.';
            return;
        }
        const max = Math.max(...cells.map(c => c.avg), 1);
        const best = [...cells].sort((a, b) => a.avg - b.avg).slice(0, 3);
        const key = (d, h) => `${d}:${h}`;
        const byKey = new Map(cells.map(c => [key(c.d, c.h), c]));
        const bestKeys = new Set(best.map(c => key(c.d, c.h)));
        const now = new Date(), nowKey = key((now.getDay() + 6) % 7, now.getHours());
        let html = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="rt-h">${h % 6 === 0 ? hourLabel(h) : ''}</span>`).join('');
        DAYS.forEach((day, d) => {
            html += `<span class="rt-d">${day}</span>`;
            for (let h = 0; h < 24; h++) {
                const c = byKey.get(key(d, h));
                const k = key(d, h);
                html += c
                    ? `<i class="${bestKeys.has(k) ? 'best' : ''} ${k === nowKey ? 'now' : ''}" style="--v:${(c.avg / max).toFixed(2)}" title="${day} ${hourLabel(h)}: ~${Math.round(c.avg)} online"></i>`
                    : `<i class="none ${k === nowKey ? 'now' : ''}" title="${day} ${hourLabel(h)}: no data yet"></i>`;
            }
        });
        grid.innerHTML = `<div class="rt-grid">${html}</div>`;
        $('#raidtime-best').textContent = `${DAYS[best[0].d]} ${hourLabel(best[0].h)}`;
        $('#raidtime-note').innerHTML = `Quietest: ${best.map(c => `<b>${DAYS[c.d]} ${hourLabel(c.h)}</b> (~${Math.round(c.avg)} online)`).join(', ')}. `
            + `Based on ${dates.size} day${dates.size === 1 ? '' : 's'} of player counts ScrapScout saw while it was open, in your local time.${dates.size < 4 ? ' Leave ScrapScout open for a few days to fill in the gaps.' : ''}`;
    }

    const SHAPES = {
        Foundation: 200, 'Triangle Foundation': 100, Wall: 200, 'Half Wall': 200, 'Low Wall': 100, Doorway: 140, Window: 140,
        'Wall Frame': 100, Floor: 100, 'Floor Triangle': 50, 'Floor Frame': 100, 'Floor Triangle Frame': 50, Roof: 100,
        'Roof Triangle': 100, 'U Shaped Stairs': 200, 'Stairs L Shape': 200, 'Stairs Spiral': 200, Ramp: 100, Steps: 100
    };
    const TIERS = {
        wood: { label: 'Wood', item: '-151838493', cost: m => m },
        stone: { label: 'Stone', item: '-2099697608', cost: m => m * 1.5 },
        metal: { label: 'Sheet metal', item: '69511070', cost: m => m },
        hqm: { label: 'Armored', item: '317398316', cost: m => Math.ceil(m / 8) }
    };
    const PRESETS = {
        '2x1 starter': [['Foundation', 'stone', 2], ['Wall', 'stone', 5], ['Doorway', 'stone', 1], ['Floor', 'stone', 2]],
        '2x2 stone': [['Foundation', 'stone', 4], ['Wall', 'stone', 15], ['Doorway', 'stone', 1], ['Floor', 'stone', 4], ['Roof', 'stone', 4]],
        '2x2 metal': [['Foundation', 'metal', 4], ['Wall', 'metal', 15], ['Doorway', 'metal', 1], ['Floor', 'metal', 4], ['Roof', 'metal', 4]]
    };
    const BRACKETS = [[15, 0.1], [35, 0.15], [75, 0.2], [Infinity, 0.333]];
    let rows = store.get('buildRows', PRESETS['2x2 stone'].map(([shape, tier, n]) => ({ shape, tier, n })));

    const upkeepFraction = blocks => {
        let left = blocks, total = 0;
        for (const [size, f] of BRACKETS) { const n = Math.min(left, size); total += n * f; left -= n; }
        return blocks ? total / blocks : 0;
    };

    function renderBuild() {
        $('#bc-presets').innerHTML = Object.keys(PRESETS).map(p => `<button class="btn ghost small" data-preset="${esc(p)}">${esc(p)}</button>`).join('');
        $('#bc-rows').innerHTML = rows.map((r, i) => `<div class="bc-row">
            <select data-i="${i}" data-k="shape">${Object.keys(SHAPES).map(s => `<option ${s === r.shape ? 'selected' : ''}>${s}</option>`).join('')}</select>
            <select data-i="${i}" data-k="tier">${Object.entries(TIERS).map(([k, t]) => `<option value="${k}" ${k === r.tier ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
            <input data-i="${i}" data-k="n" type="number" min="0" max="999" value="${r.n}">
            <button class="icon-btn" data-del="${i}" title="Remove">✕</button></div>`).join('');
        const cost = Object.fromEntries(Object.keys(TIERS).map(k => [k, 0]));
        let blocks = 0;
        for (const r of rows) {
            const n = Math.max(0, Math.floor(Number(r.n) || 0));
            blocks += n;
            cost[r.tier] += TIERS[r.tier].cost(SHAPES[r.shape] || 0) * n;
        }
        const f = upkeepFraction(blocks);
        const line = (k, v) => `<div class="slot big" title="${TIERS[k].label}">${icon(TIERS[k].item, 'icon')}<span>${fmt(v)}</span><em>${esc(itemName(TIERS[k].item))}</em></div>`;
        const used = Object.keys(TIERS).filter(k => cost[k]);
        $('#bc-out').innerHTML = !blocks ? '' : `
            <h3>To build</h3><div class="slots">${used.map(k => line(k, cost[k])).join('')}</div>
            <h3>Upkeep per day</h3><div class="slots">${used.map(k => line(k, Math.ceil(cost[k] * f))).join('')}</div>
            <p class="hint">${blocks} building blocks, upkeep rate ${(f * 100).toFixed(1)}% of the build cost per day. Keep a week's worth in the TC: ${used.map(k => `${fmt(Math.ceil(cost[k] * f * 7))} ${esc(itemName(TIERS[k].item)).toLowerCase()}`).join(', ')}. Doors and deployables add a little on top.</p>`;
        $('#bc-summary').textContent = blocks ? `${blocks} blocks` : '';
        const save = () => { store.set('buildRows', rows); renderBuild(); };
        $$('#bc-rows [data-k]').forEach(el => el.onchange = () => { rows[el.dataset.i][el.dataset.k] = el.dataset.k === 'n' ? Number(el.value) : el.value; save(); });
        $$('#bc-rows [data-del]').forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.del), 1); save(); });
        $$('#bc-presets [data-preset]').forEach(b => b.onclick = () => { rows = PRESETS[b.dataset.preset].map(([shape, tier, n]) => ({ shape, tier, n })); save(); });
    }
    $('#bc-add').onclick = () => { rows.push({ shape: 'Wall', tier: 'stone', n: 1 }); store.set('buildRows', rows); renderBuild(); };
    bus.on('ready', renderBuild);

    bus.on('reset', () => { renderWipe(); setTimeout(renderRaidTime, 1500); });
    bus.on('tab:team', renderWipe);
    bus.on('tab:raid', renderRaidTime);
    setInterval(() => { if ($('section[data-panel="team"]')?.classList.contains('active')) renderWipe(); }, 30000);
})();
