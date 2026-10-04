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
        $('#threat-key-hint').style.display = data.apiKey ? 'none' : '';
        $('#threat-list').innerHTML = data.killers.map((k, i) => {
            const p = k.profile || {};
            const flags = [
                p.vacBanned ? '<span class="tag red">VAC</span>' : '',
                p.gameBans ? `<span class="tag red">${p.gameBans} game ban${p.gameBans > 1 ? 's' : ''}</span>` : '',
                p.private ? '<span class="tag">private</span>' : '',
                p.rustHours != null ? `<span class="tag">${p.rustHours.toLocaleString()}h rust</span>` : '',
                p.created ? `<span class="tag">acct ${dur(Date.now() - p.created).split(' ')[0]}</span>`
                    : p.memberSince ? `<span class="tag">since ${esc(p.memberSince)}</span>` : ''
            ].join('');
            const avatar = p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : `<div class="avatar ph">${k.killerId ? '?' : '☠'}</div>`;
            const link = k.killerId ? `href="https://steamcommunity.com/profiles/${esc(k.killerId)}" target="_blank" rel="noopener"` : '';
            return `<a class="item threat" ${link}>
                <span class="rank">${i + 1}</span>${avatar}
                <div class="grow"><div class="title">${esc(p.name || k.name)}</div>
                <div class="sub">killed you <b class="flame">${k.kills}×</b> · last ${ago(k.last)}</div><div>${flags}</div></div>
            </a>`;
        }).join('') || empty('No player has killed you yet (since this app started listening). Deaths arrive as Rust+ notifications sent by the game server, so a server whose Rust+ isn’t working sends none. Animal and NPC deaths show under Recent deaths.');

        $('#threat-recent').innerHTML = data.recent.slice(0, 25).map(d => `
            <div class="log-row teamDeath"><span class="ic">✕</span><span class="grow">${esc(d.title || `Killed by ${d.killerName}`)}${d.server ? ` <span class="muted">· ${esc(d.server)}</span>` : ''}</span><span class="muted">${ago(d.t)}</span></div>`).join('');
    }

    bus.on('tab:threats', load);
    bus.on('threatsChanged', () => loaded && load());
})();
