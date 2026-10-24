'use strict';

(() => {
    const TYPE_LABEL = { switch: 'Smart Switch', alarm: 'Smart Alarm', monitor: 'Storage Monitor' };

    function card(d) {
        const unreachable = d.reachable ? '' : '<span class="tag red">unreachable</span>';
        const head = `<div class="dev-head"><div class="grow"><div class="title" data-rename="${d.id}" title="Click to rename">${esc(d.name)}</div>
            <div class="sub">${TYPE_LABEL[d.type]} · #${d.id} ${unreachable}</div></div>
            <button class="icon-btn" data-remove="${d.id}" title="Remove">✕</button></div>`;

        if (d.type === 'switch') {
            return `<div class="device ${d.value ? 'on' : ''}">${head}
                <button class="switch ${d.value ? 'on' : ''}" data-toggle="${d.id}" data-value="${d.value ? 0 : 1}" ${d.reachable ? '' : 'disabled'}>
                <span class="knob"></span><span class="label">${d.value ? 'ON' : 'OFF'}</span></button></div>`;
        }
        if (d.type === 'alarm') {
            return `<div class="device alarm ${d.value ? 'firing' : ''}">${head}
                <div class="alarm-state">${d.value ? '<b class="flame">TRIGGERED</b>' : 'quiet'} · last ${d.lastTrigger ? ago(d.lastTrigger) : 'never'}</div></div>`;
        }
        const upkeep = d.hasProtection
            ? (d.protectionExpiry * 1000 > Date.now()
                ? `<div class="upkeep ${d.protectionExpiry * 1000 - Date.now() < 3 * 3600e3 ? 'low' : ''}">Upkeep <b data-expiry="${d.protectionExpiry}">${dur(d.protectionExpiry * 1000 - Date.now())}</b></div>`
                : '<div class="upkeep low"><b>DECAYING</b> — no upkeep left</div>')
            : '';
        const items = [...d.items].sort((a, b) => b.quantity - a.quantity).map(i =>
            `<div class="slot" title="${esc(itemName(i.itemId))}">${icon(i.itemId, 'icon')}<span>${fmt(i.quantity)}</span></div>`).join('');
        const rules = (d.rules || []).map((r, i) => `<div class="rule ${r.fired ? 'fired' : ''}">${icon(r.itemId)}<span class="grow">${esc(itemName(r.itemId))} ${r.op} <b>${fmt(r.qty)}</b></span>
            <button class="icon-btn" data-rule-del="${d.id}" data-i="${i}" title="Remove">✕</button></div>`).join('');
        const choices = [...new Set([...d.items.map(i => String(i.itemId)), ...WATCH_ITEMS])].filter(id => S.items[id])
            .map(id => `<option value="${id}">${esc(itemName(id))}</option>`).join('');
        return `<div class="device monitor">${head}${upkeep}
            <div class="sub">${d.items.length}/${d.capacity || '?'} slots</div>
            <div class="slots">${items || '<span class="muted">empty</span>'}</div>
            <details class="rules"><summary>Alerts${d.rules?.length ? ` <span class="tag">${d.rules.length}</span>` : ''}</summary>
                ${rules || '<p class="hint">Get an alert (and a Discord ping) when something in this box goes above or below an amount.</p>'}
                <form class="rule-add" data-rule-add="${d.id}"><select name="itemId">${choices}</select>
                    <select name="op"><option value="below">below</option><option value="above">above</option></select>
                    <input name="qty" type="number" min="0" value="1000"><button class="btn small">Add</button></form>
            </details></div>`;
    }
    const WATCH_ITEMS = ['-1581843485', '-592016202', '-265876753', '1248356124', '-742865266', '69511070', '317398316', '-2099697608', '-151838493', '-932201673', '-946369541', '-1938052175'];

    const saveRules = (id, rules) => api(`/api/devices/${id}/rules`, { method: 'PUT', body: { rules } })
        .catch(e => toast({ kind: 'alarm', label: 'Could not save', text: e.message }));

    function render() {
        const list = S.devices || [];
        const groups = ['switch', 'alarm', 'monitor'].map(type => {
            const ds = list.filter(d => d.type === type);
            return ds.length ? `<div class="raid-cat">${TYPE_LABEL[type]}s</div><div class="device-grid">${ds.map(card).join('')}</div>` : '';
        }).join('');
        $('#device-list').innerHTML = groups || empty('No devices yet. In game, hold E on a smart switch, alarm or storage monitor and pick <b>Pair</b> — it shows up here instantly.');

        $$('#device-list [data-toggle]').forEach(b => b.onclick = async () => {
            b.disabled = true;
            try { await api(`/api/devices/${b.dataset.toggle}/value`, { method: 'POST', body: { value: b.dataset.value === '1' } }); }
            catch (e) { toast({ kind: 'alarm', label: 'Switch failed', text: e.message }); b.disabled = false; }
        });
        $$('#device-list [data-remove]').forEach(b => b.onclick = async () => {
            if (!confirm('Remove this device?')) return;
            await api(`/api/devices/${b.dataset.remove}`, { method: 'DELETE' }).catch(() => {});
        });
        $$('#device-list [data-rule-add]').forEach(f => f.onsubmit = e => {
            e.preventDefault();
            const d = S.devices.find(x => x.id === f.dataset.ruleAdd);
            const r = Object.fromEntries(new FormData(f));
            saveRules(d.id, [...(d.rules || []), r]);
        });
        $$('#device-list [data-rule-del]').forEach(b => b.onclick = () => {
            const d = S.devices.find(x => x.id === b.dataset.ruleDel);
            saveRules(d.id, d.rules.filter((_, i) => i !== Number(b.dataset.i)));
        });
        $$('#device-list details.rules').forEach(el => {
            const key = `rules-open-${el.closest('.device').querySelector('[data-rename]').dataset.rename}`;
            el.open = !!store.get(key, false);
            el.ontoggle = () => store.set(key, el.open);
        });
        $$('#device-list [data-rename]').forEach(el => el.onclick = async () => {
            const name = prompt('Device name', el.textContent);
            if (name) await api(`/api/devices/${el.dataset.rename}`, { method: 'PUT', body: { name } }).catch(() => {});
        });
    }

    $('#device-refresh').onclick = async () => {
        try { await api('/api/devices/refresh', { method: 'POST' }); } catch (e) { toast({ kind: 'alarm', label: 'Refresh failed', text: e.message }); }
    };
    $('#device-form').onsubmit = async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        try {
            await api('/api/devices', { method: 'POST', body });
            e.target.reset();
        } catch (err) { toast({ kind: 'alarm', label: 'Could not add', text: err.message }); }
    };

    bus.on('devices', render);
    bus.on('pro', render);
    bus.on('reset', render);
    setInterval(() => $$('#device-list [data-expiry]').forEach(el => el.textContent = dur(Number(el.dataset.expiry) * 1000 - Date.now())), 1000);
})();
