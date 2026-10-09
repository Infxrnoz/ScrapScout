'use strict';

(() => {
    function liveStatus() {
        const st = S.snapshot?.status || 'connecting';
        if (st === 'online') return '<b class="ok">connected</b>';
        if (st === 'not answering') return '<b class="flame">not answering Rust+ — retrying</b>';
        return `<b class="warn">${esc(st)}…</b>`;
    }

    function renderServers() {
        const s = S.servers;
        if (!s) return;
        $('#fcm-status').innerHTML = `Push listener: <b class="${s.fcm === 'listening' ? 'ok' : 'flame'}">${esc(s.fcm)}</b>`
            + (window.desktop ? ` <button class="btn small${s.fcm === 'listening' ? ' ghost' : ''}" id="link-steam">${s.fcm === 'listening' ? 'Re-link Steam' : 'Link Steam'}</button>` : '');
        $('#link-steam')?.addEventListener('click', linkSteam);
        $('#server-list').innerHTML = s.list.map(v => `
            <div class="item flat ${v.id === s.active ? 'active-server' : ''}">
                <div class="grow"><div class="title">${esc(v.name)}</div><div class="sub">${esc(v.id)}${v.id === s.active ? ` · ${liveStatus()}` : ''}</div></div>
                ${v.id === s.active ? '' : `<button class="btn small" data-act="${esc(v.id)}">Connect</button>`}
                <button class="icon-btn" data-del="${esc(v.id)}">✕</button>
            </div>`).join('') || empty('No servers paired yet.');
        $$('#server-list [data-act]').forEach(b => b.onclick = () => api(`/api/servers/${encodeURIComponent(b.dataset.act)}/activate`, { method: 'POST' }).catch(() => {}));
        $$('#server-list [data-del]').forEach(b => b.onclick = async () => {
            if (!confirm('Remove this server?')) return;
            S.servers = await api(`/api/servers/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
            renderServers();
        });
    }

    $('#server-form').onsubmit = async e => {
        e.preventDefault();
        try {
            await api('/api/servers', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            e.target.reset();
        } catch (err) { toast({ kind: 'alarm', label: 'Could not add server', text: err.message }); }
    };

    let settings = null;

    async function loadSettings() {
        try { settings = await api('/api/settings'); } catch { return; }
        $('#set-webhook').value = settings.discordWebhook;
        $('#set-steamkey').value = settings.steamApiKey;
        $('#set-rustmaps').value = settings.rustMapsKey;
        $('#set-bot').checked = settings.bot.enabled;
        $('#set-prefix').value = settings.bot.prefix;
        $('#set-upkeep').value = settings.upkeepAlertHours;
        $('#set-decay').value = settings.decayAlertMinutes;
        $('#set-desktop').checked = store.get('desktopNotify', !!window.desktop);
        $('#set-dbot').checked = settings.discordBot.enabled;
        $('#set-dbot-token').value = settings.discordBot.token;
        $('#set-dbot-channel').value = settings.discordBot.channelId;
        $('#set-dbot-prefix').value = settings.discordBot.prefix;
        $('#set-dbot-say').checked = settings.discordBot.allowSay;
        $('#dbot-status').textContent = `Status: ${settings.discordBotStatus}`;
        const e = settings.escalation;
        $('#set-esc').checked = e.enabled;
        $('#set-esc-sound').checked = e.sound;
        $('#set-esc-every').value = e.repeatMinutes;
        $('#set-esc-max').value = e.maxRepeats;
        $('#set-esc-mention').value = e.mention;
        $('#alert-matrix').innerHTML = `<div class="matrix-head"><span></span><span>Toast</span><span>Discord</span></div>` +
            Object.entries(settings.alertKinds).map(([k, label]) => `
                <label class="matrix-row"><span>${esc(label)}</span>
                <input type="checkbox" data-alert="${k}" data-ch="toast" ${settings.alerts[k].toast ? 'checked' : ''}>
                <input type="checkbox" data-alert="${k}" data-ch="discord" ${settings.alerts[k].discord ? 'checked' : ''}></label>`).join('');
    }

    async function saveSettings() {
        const alerts = {};
        $$('#alert-matrix input').forEach(cb => (alerts[cb.dataset.alert] ??= {})[cb.dataset.ch] = cb.checked);
        try {
            await api('/api/settings', {
                method: 'PUT', body: {
                    discordWebhook: $('#set-webhook').value.trim(), steamApiKey: $('#set-steamkey').value.trim(), rustMapsKey: $('#set-rustmaps').value.trim(),
                    bot: { enabled: $('#set-bot').checked, prefix: $('#set-prefix').value.trim() || '!' },
                    discordBot: {
                        enabled: $('#set-dbot').checked, token: $('#set-dbot-token').value.trim(), channelId: $('#set-dbot-channel').value.trim(),
                        prefix: $('#set-dbot-prefix').value.trim() || '!', allowSay: $('#set-dbot-say').checked
                    },
                    upkeepAlertHours: $('#set-upkeep').value, decayAlertMinutes: $('#set-decay').value, alerts,
                    ...(S.pro ? { escalation: {
                        enabled: $('#set-esc').checked, sound: $('#set-esc-sound').checked, mention: $('#set-esc-mention').value.trim(),
                        repeatMinutes: $('#set-esc-every').value, maxRepeats: $('#set-esc-max').value
                    } } : {})
                }
            });
            toast({ kind: 'teamOnline', label: 'Saved', text: 'Settings updated' });
            loadSettings();
            setTimeout(loadSettings, 4000);
        } catch (e) { toast({ kind: 'alarm', label: 'Not saved', text: e.message }); }
    }

    $('#settings-save').onclick = saveSettings;
    $('#esc-test').onclick = () => api('/api/escalation/test', { method: 'POST' }).catch(e => toast({ kind: 'alarm', label: 'Test failed', text: e.message }));
    $('#webhook-test').onclick = async () => {
        try {
            await api('/api/settings/test-webhook', { method: 'POST' });
            toast({ kind: 'teamOnline', label: 'Webhook works', text: 'Check your Discord channel' });
        } catch (e) { toast({ kind: 'alarm', label: 'Webhook failed', text: `${e.message} (save it first)` }); }
    };
    $('#set-desktop').onchange = async e => {
        if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
            e.target.checked = (await Notification.requestPermission()) === 'granted';
        }
        store.set('desktopNotify', e.target.checked);
    };

    if (window.desktop) {
        $('#overlay-settings').hidden = false;
        const XH = ['size', 'gap', 'thickness', 'opacity'];
        let ov = null;
        const preview = () => {
            const cv = $('#xh-preview'), ctx = cv.getContext('2d');
            const g = ctx.createLinearGradient(0, 0, 0, cv.height);
            g.addColorStop(0, '#3c4a52'); g.addColorStop(0.6, '#2a3024'); g.addColorStop(1, '#1b1d18');
            ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
            drawCrosshair(ctx, cv.width / 2, cv.height / 2, { ...ov.crosshair, on: true });
        };
        const fill = o => {
            ov = o;
            $('#ov-hud').checked = o.hud; $('#ov-corner').value = o.hudCorner;
            $('#xh-on').checked = o.crosshair.on; $('#xh-style').value = o.crosshair.style; $('#xh-color').value = o.crosshair.color;
            $('#xh-outline').checked = o.crosshair.outline; $('#xh-dot').checked = o.crosshair.dot;
            for (const k of XH) { $(`#xh-${k}`).value = o.crosshair[k]; $(`#xh-${k}-v`).textContent = k === 'opacity' ? `${Math.round(o.crosshair[k] * 100)}%` : o.crosshair[k]; }
            $('#ov-display').value = o.display ?? '';
            preview();
        };
        const send = async patch => fill(await window.desktop.setOverlay(patch));
        $('#ov-hud').onchange = e => send({ hud: e.target.checked });
        $('#ov-corner').onchange = e => send({ hudCorner: e.target.value });
        $('#ov-display').onchange = e => send({ display: e.target.value ? Number(e.target.value) : null });
        $('#xh-on').onchange = e => send({ crosshair: { on: e.target.checked } });
        $('#xh-style').onchange = e => send({ crosshair: { style: e.target.value } });
        $('#xh-color').oninput = e => send({ crosshair: { color: e.target.value } });
        $('#xh-outline').onchange = e => send({ crosshair: { outline: e.target.checked } });
        $('#xh-dot').onchange = e => send({ crosshair: { dot: e.target.checked } });
        for (const k of XH) $(`#xh-${k}`).oninput = e => send({ crosshair: { [k]: Number(e.target.value) } });
        window.desktop.onOverlay(fill);

        $('#color-settings').hidden = false;
        const COL = { vib: v => `${v}%`, sat: v => `${v}%`, bri: v => `${v}%`, con: v => `${v}%`, gam: v => Number(v).toFixed(2), temp: v => v == 0 ? 'Neutral' : v > 0 ? `Warm ${v}` : `Cool ${-v}` };
        let col = null;
        const fillColor = c => {
            col = c;
            const r = c.result || {}, p = c.profiles[c.active];
            $('#col-profile').innerHTML = c.profiles.map((x, i) => `<option value="${i}">${esc(x.name)}${c.on && i === c.active ? ' (on)' : ''}</option>`).join('');
            $('#col-profile').value = c.active;
            $('#col-on').checked = c.on;
            if (document.activeElement !== $('#col-name')) $('#col-name').value = p.name;
            $('#col-delete').disabled = c.profiles.length < 2;
            for (const k in COL) {
                const v = k === 'vib' && p.vib < 0 ? (r.driverVibrance >= 0 ? r.driverVibrance : 50) : p[k];
                $(`#col-${k}`).value = v;
                $(`#col-${k}-v`).textContent = COL[k](v) + (k === 'vib' && p.vib < 0 ? ' (driver)' : '');
            }
            $('#col-method').textContent = !c.on ? '' : r.ok === false ? 'Windows refused the change on this PC.'
                : r.method === 'filter' ? 'Windows has no gamma control here (monitors disabled in Device Manager?), so gamma is approximated.'
                : r.vibrance === 'amd' ? 'Vibrance uses your AMD driver’s saturation.'
                : r.vibrance === 'filter' ? 'No NVIDIA or AMD driver control found, so vibrance uses a Windows colour filter. Play Rust in borderless fullscreen for it to show.' : '';
            if (!$('#col-presets').children.length) {
                $('#col-presets').innerHTML = Object.keys(c.presets).map(n => `<button data-preset="${esc(n)}">${esc(n)}</button>`).join('');
                for (const b of $('#col-presets').children) b.onclick = () => sendColor({ profile: col.presets[b.dataset.preset], on: true });
            }
            for (const b of $('#col-presets').children) b.classList.toggle('active', Object.entries(c.presets[b.dataset.preset]).every(([k, v]) => p[k] == v));
        };
        let colorPending = 0;
        const sendColor = async patch => {
            colorPending++;
            const c = await window.desktop.setColor(patch);
            if (--colorPending === 0) fillColor(c);
        };
        $('#col-profile').onchange = e => { $('#col-name').blur(); sendColor({ active: Number(e.target.value) }); };
        $('#col-on').onchange = e => sendColor({ on: e.target.checked });
        $('#col-new').onclick = async () => {
            await sendColor({ profiles: [...col.profiles, { ...col.profiles[col.active], name: `Profile ${col.profiles.length + 1}` }], active: col.profiles.length });
            $('#col-name').select();
        };
        $('#col-name').onchange = e => e.target.value.trim() && sendColor({ profile: { name: e.target.value.trim() } });
        $('#col-delete').onclick = () => {
            if (col.profiles.length < 2 || !confirm(`Delete "${col.profiles[col.active].name}"?`)) return;
            sendColor({ profiles: col.profiles.filter((_, i) => i !== col.active), active: Math.max(0, col.active - 1) });
        };
        for (const k in COL) $(`#col-${k}`).oninput = e => sendColor({ profile: { [k]: Number(e.target.value) }, on: true });
        window.desktop.onColor(c => { if (!colorPending) fillColor(c); });
        window.desktop.getColor().then(fillColor);
        (async () => {
            const keys = await window.desktop.hotkeys();
            for (const k of ['app', 'hud', 'crosshair', 'color']) $(`#key-${k}`).textContent = keys[k];
            const displays = await window.desktop.displays();
            $('#ov-display').innerHTML = '<option value="">Main screen</option>' + displays.map(d => `<option value="${d.id}">${esc(d.label)}</option>`).join('');
            fill(await window.desktop.getOverlay());
        })();
    }

    bus.on('servers', renderServers);
    bus.on('status', renderServers);
    bus.on('reset', renderServers);
    bus.on('tab:settings', loadSettings);
})();
