'use strict';

(() => {
    let loaded = false;

    async function load() {
        let data;
        try { data = await api('/api/threats'); } catch (e) {
            $('#threat-list').innerHTML = empty(esc(e.message));
            return;
        }
        loaded = true;
        $('#threat-key-hint').style.display = data.apiKey || !data.pro ? 'none' : '';
        const STATUS = { rust: ['online', 'In Rust'], steam: ['steam', 'On Steam'], offline: ['offline', 'Offline'] };
        const hrs = v => v == null ? '–' : `${v.toLocaleString()} h`;
        const num = v => v == null ? '–' : v.toLocaleString();
        if (!data.pro) {
            $('#threat-list').innerHTML = (data.killers.length ? '<p class="pro-lock">Pro adds each killer\'s account age, hours, past names, friends, bans and whether they\'re online now.</p>' : '')
                + data.killers.map((k, i) => `<div class="item threat"><span class="rank">${i + 1}</span>
                    <div class="grow"><div class="title">${esc(k.name)}</div><div class="sub">killed you <b class="flame">${k.kills}×</b> · last ${ago(k.last)}</div></div></div>`).join('')
                || empty('No player has killed you yet (since this app started listening). Deaths arrive as Rust+ notifications sent by the game server, so a server whose Rust+ isn’t working sends none. Animal and NPC deaths show under Recent deaths.');
        } else $('#threat-list').innerHTML = data.killers.map((k, i) => {
            const p = k.profile || {};
            const st = STATUS[k.status];
            const created = p.created ? new Date(p.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : p.memberSince || '–';
            const steamUrl = k.killerId ? `https://steamcommunity.com/profiles/${esc(k.killerId)}` : null;
            return `<div class="threat-card${i === 0 ? ' top' : ''}">
                ${i === 0 ? '<div class="tc-kicker">Top killer</div>' : ''}
                <div class="tc-head">
                    ${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : `<div class="avatar ph">${esc((p.name || k.name || '?')[0])}</div>`}
                    <div class="grow"><div class="tc-name">${esc(p.name || k.name)}</div></div>
                    ${steamUrl ? `<a class="icon-btn" href="${steamUrl}" target="_blank" rel="noopener" title="Steam profile">↗</a>` : ''}
                </div>
                <div class="tc-badges">
                    ${st ? `<span class="tc-badge ${st[0]}">${st[1]}</span>` : ''}
                    <span class="tc-badge kills">${k.kills} kill${k.kills > 1 ? 's' : ''}</span>
                    ${p.vacBanned ? '<span class="tc-badge ban">VAC ban</span>' : ''}
                    ${p.gameBans ? `<span class="tc-badge ban">${p.gameBans} game ban${p.gameBans > 1 ? 's' : ''}</span>` : ''}
                    ${p.private ? '<span class="tc-badge">Private</span>' : ''}
                </div>
                <div class="tc-stats">
                    <div><span>Created</span><b>${esc(created)}</b></div>
                    <div><span>Names</span><b>${num(p.names)}</b></div>
                    <div><span>Friends</span><b>${num(p.friends)}</b></div>
                    <div><span>Rust</span><b>${hrs(p.rustHours)}</b></div>
                    <div><span>Rust 2w</span><b>${hrs(p.rust2w)}</b></div>
                    <div><span>Steam</span><b>${hrs(p.steamHours)}</b></div>
                </div>
                <div class="tc-foot">☠ killed you ${ago(k.last)}${k.servers?.length ? ` · ${esc(k.servers[k.servers.length - 1])}` : ''}</div>
            </div>`;
        }).join('') || empty('No player has killed you yet (since this app started listening). Deaths arrive as Rust+ notifications sent by the game server, so a server whose Rust+ isn’t working sends none. Animal and NPC deaths show under Recent deaths.');

        $('#threat-recent').innerHTML = data.recent.slice(0, 25).map(d => `
            <div class="log-row teamDeath"><span class="ic">✕</span><span class="grow">${esc(d.title || `Killed by ${d.killerName}`)}${d.server ? ` <span class="muted">· ${esc(d.server)}</span>` : ''}</span><span class="muted">${ago(d.t)}</span></div>`).join('');
    }

    bus.on('tab:threats', load);
    bus.on('threatsChanged', () => loaded && load());
})();
