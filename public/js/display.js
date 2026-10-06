'use strict';

(() => {
    if (!window.desktop?.displayGet) return;
    $('#rail-display').hidden = false;
    const PRESETS = [[1440, 1080], [1280, 960], [1024, 768]];
    let displays = [];
    let countdown = null;

    const aspect = (w, h) => w / h;
    const label = (w, h) => {
        const a = aspect(w, h);
        return `${w} × ${h}${Math.abs(a - 4 / 3) < 0.01 ? ' (4:3)' : Math.abs(a - 16 / 9) < 0.01 ? ' (16:9)' : Math.abs(a - 16 / 10) < 0.01 ? ' (16:10)' : Math.abs(a - 5 / 4) < 0.01 ? ' (5:4)' : ''}`;
    };

    function card(d, i) {
        const [cw, ch, chz, cfix] = d.current;
        const res = [...new Map(d.modes.map(([w, h]) => [`${w}x${h}`, [w, h]])).values()].sort((a, b) => b[0] * b[1] - a[0] * a[1]);
        const native = res[0];
        const rates = (w, h) => d.modes.filter(m => m[0] === w && m[1] === h).map(m => m[2]).sort((a, b) => b - a);
        const presets = PRESETS.filter(([w, h]) => rates(w, h).length);
        return `<div class="detail-card disp" data-i="${i}">
            <div class="row-between"><b>${esc(d.monitor)}${d.primary ? ' <span class="tag">main</span>' : ''}</b><span class="muted small">${cw}×${ch} @ ${chz} Hz${cfix === 2 ? ' · stretched' : ''}</span></div>
            <div class="row" style="margin-top:8px">
                <label class="field grow">Resolution<select data-k="res">${res.map(([w, h]) => `<option value="${w}x${h}" ${w === cw && h === ch ? 'selected' : ''}>${label(w, h)}${w === native[0] && h === native[1] ? ' · native' : ''}</option>`).join('')}</select></label>
                <label class="field">Refresh<select data-k="hz"></select></label>
            </div>
            <label class="field" data-scale>Scaling<select data-k="fixed">
                <option value="2" ${cfix === 2 ? 'selected' : ''}>Stretched (fill the screen)</option>
                <option value="1" ${cfix === 1 ? 'selected' : ''}>Black bars (keep shape)</option>
                <option value="0" ${cfix === 0 ? 'selected' : ''}>Driver default</option>
            </select></label>
            ${presets.length ? `<div class="hint">Stretched 4:3:</div><div class="seg">${presets.map(([w, h]) => `<button data-preset="${w}x${h}">${w}×${h}</button>`).join('')}<button data-preset="${native[0]}x${native[1]}" data-native>Native</button></div>` : ''}
            ${d.hdr === null ? '' : `<label class="check"><input type="checkbox" data-k="hdr" ${d.hdr ? 'checked' : ''}> HDR</label>`}
            <button class="btn small" data-apply style="margin-top:8px;width:100%">Apply</button>
        </div>`;
    }

    function wireCard(el) {
        const d = displays[+el.dataset.i];
        const sel = k => el.querySelector(`[data-k="${k}"]`);
        const fillRates = keepHz => {
            const [w, h] = sel('res').value.split('x').map(Number);
            const rs = d.modes.filter(m => m[0] === w && m[1] === h).map(m => m[2]).sort((a, b) => b - a);
            sel('hz').innerHTML = rs.map(r => `<option ${r === keepHz ? 'selected' : ''}>${r}</option>`).join('');
            const native = d.modes.reduce((a, m) => m[0] * m[1] > a[0] * a[1] ? m : a);
            const same = Math.abs(aspect(w, h) - aspect(native[0], native[1])) < 0.01;
            el.querySelector('[data-scale]').hidden = same;
            if (!same && sel('fixed').value === '0') sel('fixed').value = '2';
        };
        sel('res').onchange = () => fillRates(Number(sel('hz').value));
        fillRates(d.current[2]);
        for (const b of el.querySelectorAll('[data-preset]')) b.onclick = () => {
            sel('res').value = b.dataset.preset;
            fillRates(Math.max(...d.modes.filter(m => `${m[0]}x${m[1]}` === b.dataset.preset).map(m => m[2])));
            if (!b.hasAttribute('data-native')) sel('fixed').value = '2';
            apply();
        };
        const apply = async () => {
            const [w, h] = sel('res').value.split('x').map(Number);
            const r = await window.desktop.displaySet({ device: d.device, w, h, hz: Number(sel('hz').value), fixed: el.querySelector('[data-scale]').hidden ? -1 : Number(sel('fixed').value) });
            if (!r.ok) return status(r.error || 'Couldn’t change the display', true);
            if (r.scaling === false) status('Resolution changed, but your graphics driver ignored the stretch setting. Turn on GPU scaling in the NVIDIA/AMD control panel.');
            confirmKeep();
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
