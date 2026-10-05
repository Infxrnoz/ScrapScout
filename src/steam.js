const cache = new Map();
const TTL = 6 * 3600e3;

const tag = (xml, name) => {
    const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
    return m ? m[1].trim() : null;
};

async function profile(steamId, apiKey) {
    const hit = cache.get(steamId);
    if (hit && Date.now() - hit.at < TTL) return hit.data;

    const data = { steamId, name: null, avatar: null, vacBanned: null, memberSince: null, private: null, rustHours: null, rust2w: null, steamHours: null, friends: null, names: null, gameBans: null, daysSinceBan: null, created: null };
    try {
        const xml = await (await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, { signal: AbortSignal.timeout(8000) })).text();
        data.name = tag(xml, 'steamID');
        data.avatar = tag(xml, 'avatarMedium');
        data.vacBanned = tag(xml, 'vacBanned') === '1';
        data.memberSince = tag(xml, 'memberSince');
        data.private = tag(xml, 'privacyState') !== 'public';
    } catch {  }
    try {
        const aliases = await (await fetch(`https://steamcommunity.com/profiles/${steamId}/ajaxaliases`, { signal: AbortSignal.timeout(8000) })).json();
        if (Array.isArray(aliases)) data.names = new Set([...aliases.map(a => a.newname), data.name].filter(Boolean)).size;
    } catch {  }

    if (apiKey) {
        const api = async url => (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
        const [bans, games, summary, friends] = await Promise.allSettled([
            api(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${steamId}`),
            api(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_played_free_games=1`),
            api(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`),
            api(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamId}&relationship=friend`)
        ]);
        const ban = bans.value?.players?.[0];
        if (ban) {
            data.vacBanned = ban.VACBanned;
            data.gameBans = ban.NumberOfGameBans;
            data.daysSinceBan = ban.VACBanned || ban.NumberOfGameBans ? ban.DaysSinceLastBan : null;
        }
        const owned = games.value?.response?.games;
        const rust = owned?.find(g => g.appid === 252490);
        if (rust) { data.rustHours = Math.round(rust.playtime_forever / 60); data.rust2w = Math.round((rust.playtime_2weeks || 0) / 60); }
        if (owned?.length) data.steamHours = Math.round(owned.reduce((t, g) => t + (g.playtime_forever || 0), 0) / 60);
        const fl = friends.value?.friendslist?.friends;
        if (Array.isArray(fl)) data.friends = fl.length;
        const p = summary.value?.response?.players?.[0];
        if (p?.timecreated) data.created = p.timecreated * 1000;
        if (p?.personaname) data.name ??= p.personaname;
        if (p?.avatarmedium) data.avatar ??= p.avatarmedium;
    }

    cache.set(steamId, { at: Date.now(), data });
    return data;
}

async function summaries(ids, apiKey) {
    if (!apiKey || !ids.length) return {};
    const out = {};
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${chunk.join(',')}`, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`Steam answered ${r.status}`);
        for (const p of (await r.json()).response?.players || []) {
            out[p.steamid] = {
                name: p.personaname, avatar: p.avatarmedium, state: p.personastate, public: p.communityvisibilitystate === 3,
                gameId: p.gameid || null, gameServer: p.gameserverip || null, lastLogoff: p.lastlogoff ? p.lastlogoff * 1000 : null,
                created: p.timecreated ? p.timecreated * 1000 : null
            };
        }
    }
    return out;
}

async function resolveId(input, apiKey) {
    const s = String(input).trim();
    const direct = s.match(/(?:steamcommunity\.com\/profiles\/)?(7656\d{13})/);
    if (direct) return direct[1];
    const vanity = s.match(/steamcommunity\.com\/id\/([^/?#\s]+)/);
    if (!vanity) return null;
    if (!apiKey) throw new Error('Custom profile URLs need a Steam API key (Settings). Paste the /profiles/7656… link instead.');
    const r = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanity[1])}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.response?.success !== 1) throw new Error('Steam couldn’t find that profile');
    return j.response.steamid;
}

module.exports = { profile, summaries, resolveId };
