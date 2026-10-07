'use strict';

(() => {
    if (!window.desktop?.displayGet) return;
    $('#rail-display').hidden = false;
    const PRESETS = [[1440, 1080], [1280, 960], [1024, 768]];
    let displays = [];
    let countdown = null;

    const vendor = gpu => /nvidia/i.test(gpu) ? 'nvidia' : /amd|radeon/i.test(gpu) ? 'amd' : /intel/i.test(gpu) ? 'intel' : '';
    const HELP = {
        nvidia: {
            custom: 'Add it in NVIDIA Control Panel → Change resolution → Customize → Create Custom Resolution.',
            scale: 'In NVIDIA Control Panel → Adjust desktop size and position, set Scaling to Full-screen and "Perform scaling on" to GPU.'
        },
        amd: {
            custom: 'Add it in AMD Software → Settings → Display → Custom Resolutions → Create New.',
            scale: 'In AMD Software → Settings → Display, turn on GPU Scaling and set Scaling Mode to Full panel.'
        },
        intel: {
            custom: 'Add it in Intel Graphics Command Center (or Arc Control) → Display → Custom Resolution.',
            scale: 'In Intel Graphics Command Center (or Arc Control) → Display, set Scale to Stretch and tick Override application settings.'
        },
        '': {
            custom: 'Add it as a custom resolution in your graphics driver’s control panel first.',
            scale: 'Turn on GPU scaling (full screen / stretch) in your graphics driver’s control panel.'
        }
    };
    const aspect = (w, h) => w / h;
    const label = (w, h) => {
        const a = aspect(w, h);
        return `${w} × ${h}${Math.abs(a - 4 / 3) < 0.01 ? ' (4:3)' : Math.abs(a - 16 / 9) < 0.01 ? ' (16:9)' : Math.abs(a - 16 / 10) < 0.01 ? ' (16:10)' : Math.abs(a - 5 / 4) < 0.01 ? ' (5:4)' : ''}`;
    };

    function card(d, i) {
        const [cw, ch, chz, cfix] = d.current;
        const res = [...new Map(d.modes.map(([w, h]) => [`${w}x${h}`, [w, h]])).values()].sort((a, b) => b[0] * b[1] - a[0] * a[1]);
        const native = res[0];
        const has = (w, h) => d.modes.some(m => m[0] === w && m[1] === h);
        const presets = PRESETS.filter(([w, h]) => has(w, h));
        return `<div class="disp" data-i="${i}">
            <div class="disp-head"><b>${esc(d.monitor)}</b>${d.primary ? '<span class="tag">main</span>' : ''}<span class="muted small">${cw}×${ch} · ${chz} Hz${cfix === 2 ? ' · stretched' : ''}</span></div>
            <label class="field">Resolution<select data-k="res">${res.map(([w, h]) => `<option value="${w}x${h}" ${w === cw && h === ch ? 'selected' : ''}>${label(w, h)}${w === native[0] && h === native[1] ? ' · native' : ''}</option>`).join('')}</select></label>
            <div class="disp-custom"><span class="muted small">Custom</span><input data-k="cw" type="number" min="640" max="7680" placeholder="width"><span>×</span><input data-k="ch" type="number" min="480" max="4320" placeholder="height"></div>
            <div class="hint">Refresh rate</div>
            <div class="disp-chips" data-k="hz"></div>
            ${presets.length ? `<div class="hint">Stretched 4:3</div><div class="disp-chips">${presets.map(([w, h]) => `<button data-preset="${w}x${h}">${w}×${h}</button>`).join('')}<button data-preset="${native[0]}x${native[1]}" data-native>Native</button></div>` : ''}
            <div data-scale><div class="hint">Scaling</div><div class="disp-chips" data-k="fixed">
                <button data-v="2">Stretched</button><button data-v="1">Black bars</button><button data-v="0">Driver</button></div>
                ${vendor(d.gpu) !== 'nvidia' ? `<div class="hint">Black bars instead of stretched? ${HELP[vendor(d.gpu)].scale}</div>` : ''}</div>
            ${d.hdr === null ? '' : `<label class="toggle"><input type="checkbox" data-k="hdr" ${d.hdr ? 'checked' : ''}><i></i> HDR</label>`}
            <button class="btn small" data-apply>Apply</button>
        </div>`;
    }

    function wireCard(el) {
        const d = displays[+el.dataset.i];
        const sel = k => el.querySelector(`[data-k="${k}"]`);
        const native = d.modes.reduce((a, m) => m[0] * m[1] > a[0] * a[1] ? m : a);
        const allRates = [...new Set(d.modes.map(m => m[2]))].sort((a, b) => b - a);
        let hz = d.current[2], fixed = d.current[3] || 2;
        const chosen = () => {
            const w = Number(sel('cw').value), h = Number(sel('ch').value);
            return w && h ? [w, h, true] : [...sel('res').value.split('x').map(Number), false];
        };
        const pick = (box, v) => box.querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.v) === v));
        const refresh = () => {
            const [w, h] = chosen();
            const rs = d.modes.filter(m => m[0] === w && m[1] === h).map(m => m[2]).sort((a, b) => b - a);
            const list = rs.length ? rs : allRates;
            if (!list.includes(hz)) hz = list[0];
            sel('hz').innerHTML = list.map(r => `<button data-v="${r}">${r} Hz</button>`).join('');
            sel('hz').querySelectorAll('button').forEach(b => b.onclick = () => { hz = Number(b.dataset.v); pick(sel('hz'), hz); });
            pick(sel('hz'), hz);
            const same = Math.abs(aspect(w, h) - aspect(native[0], native[1])) < 0.01;
            el.querySelector('[data-scale]').hidden = same;
            pick(sel('fixed'), fixed);
        };
        sel('fixed').querySelectorAll('button').forEach(b => b.onclick = () => { fixed = Number(b.dataset.v); pick(sel('fixed'), fixed); });
        sel('res').onchange = () => { sel('cw').value = sel('ch').value = ''; refresh(); };
        sel('cw').oninput = sel('ch').oninput = refresh;
        refresh();
        const apply = async () => {
            const [w, h, custom] = chosen();
            if (!w || !h) return status('Enter both a width and a height.', true);
            const r = await window.desktop.displaySet({ device: d.device, w, h, hz, fixed: el.querySelector('[data-scale]').hidden ? -1 : fixed });
            const help = HELP[vendor(d.gpu)];
            if (!r.ok) return status(custom ? `Your graphics driver doesn't offer ${w}×${h} at ${hz} Hz. ${help.custom}` : (r.error || 'Couldn’t change the display'), true);
            status(r.scaling === false ? `Resolution changed, but your graphics driver ignored the stretch setting. ${help.scale}` : '');
            confirmKeep();
        };
        for (const b of el.querySelectorAll('[data-preset]')) b.onclick = () => {
            sel('cw').value = sel('ch').value = '';
            sel('res').value = b.dataset.preset;
            hz = Math.max(...d.modes.filter(m => `${m[0]}x${m[1]}` === b.dataset.preset).map(m => m[2]));
            if (!b.hasAttribute('data-native')) fixed = 2;
            refresh();
            apply();
        };
        el.querySelector('[data-apply]').onclick = apply;
        const hdr = sel('hdr');
        if (hdr) hdr.onchange = async () => {
            const r = await window.desktop.displayHdr(d.device, hdr.checked);
            if (!r.ok) { hdr.checked = !hdr.checked; status(r.error || 'Windows refused to change HDR', true); }
        };
    }

    function status(text, bad) {
        const s = $('#disp-status');
        s.textContent = text;
        s.className = `hint${bad ? ' flame' : ''}`;
    }

    function confirmKeep() {
        clearInterval(countdown);
        let left = 15;
        const bar = $('#disp-confirm');
        bar.hidden = false;
        const tick = () => { $('#disp-left').textContent = left; if (left-- <= 0) { clearInterval(countdown); bar.hidden = true; } };
        tick();
        countdown = setInterval(tick, 1000);
    }

    async function load() {
        const r = await window.desktop.displayGet();
        if (!r?.ok) return;
        displays = r.displays;
        $('#disp-list').innerHTML = displays.map(card).join('');
        $$('#disp-list .disp').forEach(wireCard);
    }

    $('#disp-keep').onclick = async () => { clearInterval(countdown); $('#disp-confirm').hidden = true; await window.desktop.displayKeep(); status('Kept.'); load(); };
    $('#disp-undo').onclick = async () => { clearInterval(countdown); $('#disp-confirm').hidden = true; await window.desktop.displayRevert(); };
    window.desktop.onDisplayReverted(() => { clearInterval(countdown); $('#disp-confirm').hidden = true; status('Switched back to your previous settings.'); load(); });
    bus.on('tab:display', load);
})();
