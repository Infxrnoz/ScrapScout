'use strict';

(() => {
    const TRIGGER_LABEL = {
        manual: 'One-tap button', night: 'When night starts in game', day: 'When day starts in game', time: 'Every day at a time',
        teamOffline: 'When the whole team goes offline', teamOnline: 'When someone comes online', alarm: 'When an alarm goes off'
    };
    let editing = null;

    const switches = () => (S.devices || []).filter(d => d.type === 'switch');
    const alarms = () => (S.devices || []).filter(d => d.type === 'alarm');
    const devName = id => S.devices.find(d => d.id === id)?.name || `#${id}`;
    const save = rules => api('/api/automations', { method: 'PUT', body: { rules } })
        .catch(e => toast({ kind: 'alarm', label: 'Not saved', text: e.message }));

    function describe(r) {
        const t = r.trigger;
        const when = t.type === 'time' ? `Every day at ${t.at}` : t.type === 'alarm' && t.alarmId !== 'any' ? `When ${devName(t.alarmId)} goes off` : TRIGGER_LABEL[t.type];
        return `${when} → turn <b>${r.action.value ? 'on' : 'off'}</b> ${r.action.ids.map(id => esc(devName(id))).join(', ') || '<i>no switches</i>'}`;
    }

    function editor(r) {
        const sw = switches();
        return `<form class="auto-edit" id="auto-form">
            <label class="field">Name<input name="name" maxlength="40" value="${esc(r.name)}" required></label>
            <label class="field">When<select name="type">${Object.entries(TRIGGER_LABEL).map(([k, l]) => `<option value="${k}" ${r.trigger.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field" data-show="time">Time (your PC's clock)<input name="at" type="time" value="${r.trigger.at}"></label>
            <label class="field" data-show="alarm">Which alarm<select name="alarmId"><option value="any">Any alarm</option>${alarms().map(a => `<option value="${a.id}" ${r.trigger.alarmId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
            <label class="field">Turn<select name="value"><option value="1" ${r.action.value ? 'selected' : ''}>on</option><option value="0" ${r.action.value ? '' : 'selected'}>off</option></select></label>
            <div class="field">Switches${sw.length ? '' : ' <span class="hint">(pair a smart switch first)</span>'}
                <div class="auto-switches">${sw.map(d => `<label class="check"><input type="checkbox" name="ids" value="${d.id}" ${r.action.ids.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
            <div class="row"><button class="btn small">Save</button><button class="btn ghost small" type="button" id="auto-cancel">Cancel</button></div>
        </form>`;
    }

    function render() {
        const box = $('#auto-list');
        $('#auto-new').hidden = false;
        const rules = S.automations || [];
        const cards = rules.map(r => editing?.id === r.id ? editor(editing) : `<div class="auto ${r.enabled ? '' : 'off'}">
            <div class="row-between"><b>${esc(r.name)}</b><label class="toggle"><input type="checkbox" data-auto-on="${r.id}" ${r.enabled ? 'checked' : ''}><i></i></label></div>
            <div class="sub">${describe(r)}</div>
            ${r.lastRun ? `<div class="hint">Last ran ${ago(r.lastRun.t)}${r.lastRun.ok ? '' : ` · <span class="flame">${r.lastRun.failed.length} failed</span>`}</div>` : ''}
            <div class="row"><button class="btn small" data-auto-run="${r.id}">Run now</button><button class="btn ghost small" data-auto-edit="${r.id}">Edit</button><button class="btn ghost small" data-auto-del="${r.id}">Delete</button></div>
        </div>`);
        if (editing && !rules.some(r => r.id === editing.id)) cards.push(editor(editing));
        box.innerHTML = cards.join('') || '<p class="hint">Make your switches react on their own: lights on at night, turrets off when the whole team logs out, or a one-tap lockdown button.</p>';
        wire(rules);
    }

    function wire(rules) {
        const form = $('#auto-form');
        if (form) {
            const showFields = () => $$('#auto-form [data-show]').forEach(el => el.hidden = el.dataset.show !== form.type.value);
            form.type.onchange = showFields;
            showFields();
            $('#auto-cancel').onclick = () => { editing = null; render(); };
            form.onsubmit = e => {
                e.preventDefault();
                const f = new FormData(form);
                const rule = {
                    ...editing, name: f.get('name'),
                    trigger: { type: f.get('type'), at: f.get('at'), alarmId: f.get('alarmId') },
                    action: { value: f.get('value') === '1', ids: f.getAll('ids') }
                };
                editing = null;
                render();
                save(rules.some(r => r.id === rule.id) ? rules.map(r => r.id === rule.id ? rule : r) : [...rules, rule]);
            };
        }
        $$('[data-auto-on]').forEach(cb => cb.onchange = () => save(rules.map(r => r.id === cb.dataset.autoOn ? { ...r, enabled: cb.checked } : r)));
        $$('[data-auto-edit]').forEach(b => b.onclick = () => { editing = structuredClone(rules.find(r => r.id === b.dataset.autoEdit)); render(); });
        $$('[data-auto-del]').forEach(b => b.onclick = () => confirm('Delete this automation?') && save(rules.filter(r => r.id !== b.dataset.autoDel)));
        $$('[data-auto-run]').forEach(b => b.onclick = async () => {
            b.disabled = true;
            try { await api(`/api/automations/${b.dataset.autoRun}/run`, { method: 'POST' }); }
            catch (e) { toast({ kind: 'alarm', label: 'Automation failed', text: e.message }); }
            b.disabled = false;
        });
    }

    $('#auto-new').onclick = () => {
        editing = { id: `a${Date.now().toString(36)}`, name: 'Lockdown', enabled: true, trigger: { type: 'manual', at: '20:00', alarmId: 'any' }, action: { value: true, ids: [] } };
        render();
    };
    for (const ev of ['automations', 'devices', 'reset', 'pro']) bus.on(ev, () => { if (!$('#auto-form')) render(); });
})();
