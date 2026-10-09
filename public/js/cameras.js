'use strict';

(() => {
    const GROUPS = {
        airfield_display_name: 'Airfield', bandit_camp: 'Bandit Camp', dome_monument_name: 'Dome', ferryterminal: 'Ferry Terminal',
        large_oil_rig: 'Large Oil Rig', missile_silo_monument: 'Missile Silo', oil_rig_small: 'Small Oil Rig', outpost: 'Outpost'
    };
    let cctv = {};
    let open = null;
    const saved = () => store.get(`cams:${S.snapshot?.server?.id || ''}`, []);
    const setSaved = list => store.set(`cams:${S.snapshot?.server?.id || ''}`, list);

    function render() {
        const here = new Set((S.snapshot?.mapMeta?.monuments || []).map(m => GROUPS[m.token]).filter(Boolean));
        here.add('Cargo Ship');
        const groups = Object.entries(cctv).filter(([name]) => here.has(name));
        const mine = saved();
        const btn = id => `<button class="chip ${open?.id === id ? 'on' : ''}" data-cam-open="${esc(id)}">${esc(id)}</button>`;
        $('#cam-list').innerHTML = (mine.length ? `<h3>Your cameras</h3><div class="chips">${mine.map(id => `<span class="chip-wrap">${btn(id)}<button class="icon-btn" data-cam-del="${esc(id)}" title="Forget">✕</button></span>`).join('')}</div>` : '')
            + `<h3>Monuments on this map</h3>${groups.map(([name, codes]) => `<div class="cam-group"><b>${esc(name)}</b><div class="chips">${codes.map(btn).join('')}</div></div>`).join('') || '<p class="hint">Load a server to see its monument cameras.</p>'}`;
        $$('[data-cam-open]').forEach(b => b.onclick = () => start(b.dataset.camOpen));
        $$('[data-cam-del]').forEach(b => b.onclick = () => { setSaved(saved().filter(x => x !== b.dataset.camDel)); render(); });
    }

    function show(state) {
        open = state;
        $('#cam-controls').hidden = !state;
        $('#cam-tip').hidden = !state;
        $('#cam-turret').hidden = !state?.turret;
        if (!state) { $('#cam-img').removeAttribute('src'); $('#cam-msg').hidden = false; }
        render();
    }

    async function start(id) {
        $('#cam-msg').hidden = false;
        $('#cam-msg').textContent = `Connecting to ${id}…`;
        try { show(await api('/api/camera', { method: 'POST', body: { id } })); $('#cam-msg').textContent = 'Waiting for the first picture…'; }
        catch (e) { show(null); $('#cam-msg').textContent = e.message; }
    }

    const input = (action, x = 0, y = 0) => api('/api/camera/input', { method: 'POST', body: { action, x, y } }).catch(e => toast({ kind: 'alarm', label: 'Camera', text: e.message }));

    $('#cam-add').onsubmit = e => {
        e.preventDefault();
        const id = e.target.id.value.trim().toUpperCase();
        if (!/^[\w-]{1,32}$/.test(id)) return toast({ kind: 'alarm', label: 'Camera', text: 'Use letters, numbers, - and _' });
        setSaved([...new Set([...saved(), id])]);
        e.target.reset();
        start(id);
    };
    $('#cam-stop').onclick = () => api('/api/camera', { method: 'DELETE' }).catch(() => {});
    $$('#cam-controls [data-move]').forEach(b => b.onclick = () => input('move', ...b.dataset.move.split(',').map(Number)));
    $$('#cam-controls [data-cam]').forEach(b => b.onclick = () => input(b.dataset.cam));
    $('#cam-arm').onchange = e => { $('#cam-controls [data-cam="shoot"]').disabled = !e.target.checked; };

    let drag = null, pending = [0, 0], timer = null;
    const view = $('#cam-view');
    view.onpointerdown = e => { if (open) { drag = [e.clientX, e.clientY]; view.setPointerCapture(e.pointerId); } };
    view.onpointermove = e => {
        if (!drag) return;
        pending = [pending[0] + (e.clientX - drag[0]) / 4, pending[1] + (e.clientY - drag[1]) / 4];
        drag = [e.clientX, e.clientY];
        timer ??= setTimeout(() => { input('move', Math.round(pending[0]), Math.round(pending[1])); pending = [0, 0]; timer = null; }, 200);
    };
    view.onpointerup = () => { drag = null; };

    bus.on('ready', () => fetch('/data/cctv.json').then(r => r.json()).then(c => { cctv = c; render(); }).catch(() => {}));
    bus.on('reset', () => { show(S.snapshot?.camera ?? null); });
    bus.on('camera', show);
    bus.on('cameraFrame', f => {
        if (!open || f.id !== open.id) return;
        $('#cam-img').src = `data:image/png;base64,${f.png}`;
        $('#cam-msg').hidden = true;
    });
})();
