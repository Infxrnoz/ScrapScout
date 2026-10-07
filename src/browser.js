const a2s = require('./a2s');

const LIST_TTL = 5 * 60e3;
const DETAIL_TTL = 60e3;
const RUST_APPID = 252490;
let listCache = { at: 0, key: null, servers: [], pending: null };
const detailCache = new Map();

const FLAGS = { '^m': 'monthly', '^w': 'weekly', '^b': 'biweekly', '^v': 'vanilla', '^h': 'hardcore', '^s': 'softcore' };
const REGIONS = ['EU', 'NA', 'SA', 'AS', 'AF', 'OC', 'WC', 'RU', 'CN'];
const webUrl = s => /^https?:\/\/[^\s"'<>]+$/i.test(String(s || '').trim()) ? String(s).trim() : null;

function parseKeywords(kw = '') {
    const out = { players: null, maxPlayers: null, queued: 0, wipe: null, region: null, flags: [], build: null, teamSize: null };
    for (const t of kw.split(',')) {
        let m;
        if ((m = t.match(/^cp(\d+)$/))) out.players = +m[1];
        else if ((m = t.match(/^mp(\d+)$/))) out.maxPlayers = +m[1];
        else if ((m = t.match(/^qp(\d+)$/))) out.queued = +m[1];
        else if ((m = t.match(/^born(\d+)$/))) out.wipe = +m[1] * 1000;
        else if ((m = t.match(/^cs(\d+)$/))) out.build = +m[1];
        else if ((m = t.match(/^ts(\d+)$/))) out.teamSize = +m[1];
        else if (FLAGS[t]) out.flags.push(FLAGS[t]);
        else if (REGIONS.includes(t)) out.region = t;
    }
    return out;
}

function fromSteam(s) {
    const [ip, queryPort] = s.addr.split(':');
    const kw = parseKeywords(s.gametype);
    return {
        id: `${ip}:${queryPort}`, ip, queryPort: +queryPort, gamePort: s.gameport,
        name: s.name, map: s.map,
        players: kw.players ?? s.players, maxPlayers: kw.maxPlayers ?? s.max_players, queued: kw.queued,
        wipe: kw.wipe, region: kw.region, flags: kw.flags, teamSize: kw.teamSize, official: /official/i.test(s.name) && /^rust/i.test(s.name)
    };
}

async function fetchList(key) {
    const query = async extra => {
        const url = `https://api.steampowered.com/IGameServersService/GetServerList/v1/?key=${encodeURIComponent(key)}`
            + `&filter=${encodeURIComponent(`\\appid\\${RUST_APPID}${extra}`)}&limit=20000`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (res.status === 403) throw new Error('Steam rejected the API key');
        if (!res.ok) throw new Error(`Steam server list failed (${res.status})`);
        return (await res.json()).response?.servers || [];
    };
    const [busy, empty] = await Promise.all([query('\\empty\\1'), query('\\noplayers\\1')]);
    const seen = new Set();
    return [...busy, ...empty].filter(s => s.appid === RUST_APPID && !seen.has(s.addr) && seen.add(s.addr)).map(fromSteam);
}

async function list(key) {
    if (!key) throw new Error('A Steam Web API key is needed to list every server');
    if (listCache.key === key && Date.now() - listCache.at < LIST_TTL) return listCache;
    if (listCache.pending) return listCache.pending;
    listCache.pending = fetchList(key)
        .then(servers => (listCache = { at: Date.now(), key, servers, pending: null }))
        .catch(e => { listCache.pending = null; throw e; });
    return listCache.pending;
}

function search(servers, { q = '', region = '', flag = '', minPlayers = 0, sort = 'players', limit = 100, offset = 0 }) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = servers.filter(s =>
        words.every(w => s.name.toLowerCase().includes(w) || s.ip.startsWith(w)) &&
        (!region || s.region === region) &&
        (!flag || s.flags.includes(flag)) &&
        s.players >= minPlayers);
    const sorters = {
        players: (a, b) => (b.players + b.queued) - (a.players + a.queued),
        wipe: (a, b) => (b.wipe || 0) - (a.wipe || 0),
        name: (a, b) => a.name.localeCompare(b.name)
    };
    out.sort(sorters[sort] || sorters.players);
    return { total: out.length, servers: out.slice(offset, offset + limit) };
}

async function resolve(address) {
    const [host, port] = address.trim().replace(/^[a-z]+:\/\//i, '').split(/[:/]/);
    let ip = host;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.split('.').some(n => +n > 255)) {
        if (/^[\d.]+$/.test(host || '')) throw new Error(`${host} is not a valid IP address`);
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host || '')) throw new Error('Enter an IPv4 address or host name, optionally with :port');
        ip = (await require('dns').promises.lookup(host, { family: 4 }).catch(() => { throw new Error(`Could not find ${host}`); })).address;
    }
    const res = await fetch(`https://api.steampowered.com/ISteamApps/GetServersAtAddress/v0001?addr=${ip}&format=json`, { signal: AbortSignal.timeout(10000) });
    const found = ((await res.json()).response?.servers || []).filter(s => s.appid === RUST_APPID).map(s => ({
        ip, queryPort: +s.addr.split(':')[1], gamePort: s.gameport
    }));
    if (!port) return found;
    const hit = found.filter(s => s.gamePort === +port || s.queryPort === +port);
    return hit.length ? hit : [{ ip, queryPort: +port, gamePort: +port }];
}

async function details(ip, queryPort) {
    const id = `${ip}:${queryPort}`;
    const hit = detailCache.get(id);
    if (hit && Date.now() - hit.at < DETAIL_TTL) return hit.data;

    const [inf, rules] = await Promise.all([a2s.info(ip, queryPort), a2s.rules(ip, queryPort).catch(() => ({}))]);
    const kw = parseKeywords(inf.keywords);
    const description = Object.keys(rules).filter(k => /^description_\d+$/.test(k)).sort()
        .map(k => rules[k]).join('').replace(/\\n/g, '\n').replace(/\\t/g, '  ').trim();
    const data = {
        id, ip, queryPort, gamePort: inf.gamePort || queryPort,
        name: inf.name, map: inf.map,
        players: kw.players ?? inf.players, maxPlayers: kw.maxPlayers ?? inf.maxPlayers, queued: kw.queued,
        wipe: kw.wipe, region: kw.region, flags: kw.flags, teamSize: kw.teamSize, build: kw.build,
        seed: rules['world.seed'] ? +rules['world.seed'] : null,
        size: rules['world.size'] ? +rules['world.size'] : null,
        mapImage: rules.map_image_url || null,
        header: webUrl(rules.headerimage), url: webUrl(rules.url), description,
        fps: rules.fps_avg ? Math.round(+rules.fps_avg) : null,
        entities: rules.ent_cnt ? +rules.ent_cnt : null,
        uptime: rules.uptime ? +rules.uptime : null,
        pve: rules.pve === 'True',
        customMap: !!rules.level_url,
        levelUrl: rules.level_url || null,
        rustMapsId: (rules.level_url || '').match(/rustmaps\.com\/\d+\/([0-9a-f]{32})\//i)?.[1] ?? null
    };
    detailCache.set(id, { at: Date.now(), data });
    return data;
}

module.exports = { list, search, resolve, details, parseKeywords };
