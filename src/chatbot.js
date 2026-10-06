const ITEMS = require('../data/items.json');
const GAME = require('../data/game.json');
const RAID = require('../data/raid.json');
const { gridOf } = require('./geo');

const dur = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
};

function findItem(query, pool = Object.keys(ITEMS)) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const scored = [];
    for (const id of pool) {
        const it = ITEMS[id];
        if (!it) continue;
        const n = it.n.toLowerCase();
        const rank = n === q ? 0 : it.s === q ? 1 : n.startsWith(q) ? 2 : n.includes(q) ? 3 : -1;
        if (rank >= 0) scored.push([rank, n.length, id]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored[0]?.[2] ?? null;
}

const splitQty = args => {
    const last = args[args.length - 1];
    if (args.length > 1 && /^\d+$/.test(last)) return [args.slice(0, -1).join(' '), Math.min(10000, Math.max(1, Number(last)))];
    return [args.join(' '), 1];
};
const NO_TEAM = 'Team info not loaded yet';

const name = id => ITEMS[id]?.n ?? id;


const PRO = new Set(['raid', 'craft', 'recycle', 'decay', 'decaylist', 'cleardecay']);

const COMMANDS = {
    help: () => `Commands: ${Object.keys(COMMANDS).filter(c => c !== 'help' && !PRO.has(c)).join(' ')} | Pro: ${[...PRO].join(' ')}`,

    pop: ({ info }) => info ? `Pop ${info.players}/${info.maxPlayers}${info.queuedPlayers ? ` (+${info.queuedPlayers} queued)` : ''}` : 'No server info yet',

    wipe: ({ info }) => info?.wipeTime ? `Wiped ${dur(Date.now() - info.wipeTime * 1000)} ago` : 'Wipe time unknown',

    time: ({ gameTime }) => {
        const t = gameTime();
        if (!t) return 'Time unknown';
        return `${t.clock} - ${t.isDay ? 'sunset' : 'sunrise'} in ${dur(t.untilChange * 1000)}`;
    },

    online: ({ team }) => {
        if (!team?.members?.length) return NO_TEAM;
        const on = (team?.members || []).filter(m => m.isOnline).map(m => m.name);
        return on.length ? `Online (${on.length}): ${on.join(', ')}` : 'Nobody online';
    },

    offline: ({ team }) => {
        if (!team?.members?.length) return NO_TEAM;
        const off = (team?.members || []).filter(m => !m.isOnline).map(m => m.name);
        return off.length ? `Offline (${off.length}): ${off.join(', ')}` : 'Everyone is online';
    },

    craft: (ctx, args) => {
        if (!args.length) return 'Usage: craft <item> [amount]';
        const [q, n] = splitQty(args);
        const id = findItem(q, Object.keys(GAME.craft));
        if (!id) return `No recipe for "${q}"`;
        const r = GAME.craft[id];
        const times = Math.ceil(n / (r.n || 1));
        return `${n}x ${name(id)}: ${r.i.map(([i, qty]) => `${qty * times} ${name(i)}`).join(', ')}${r.n > 1 ? ` (${times} crafts)` : ''}${r.wb ? ` (WB${r.wb})` : ''}`;
    },

    recycle: (ctx, args) => {
        if (!args.length) return 'Usage: recycle <item> [amount]';
        const [q, n] = splitQty(args);
        const id = findItem(q, Object.keys(GAME.recycle));
        if (!id) return `Can't recycle "${q}"`;
        const y = GAME.recycle[id].r || GAME.recycle[id].s;
        return `${n}x ${name(id)} -> ${y.map(([i, p, qty]) => `${+(qty * p * n).toFixed(1)} ${name(i)}`).join(', ')}`;
    },

    decay: ({ pins, decayTable, pushPins, team, sender, mapMeta }, args) => {
        if (!args.length) return 'Usage: decay <HP> or decay <structure> <HP>, e.g. decay 250 or decay metal wall 400';
        const hp = /^\d+$/.test(args[args.length - 1]) ? Number(args[args.length - 1]) : null;
        const q = (hp === null ? args : args.slice(0, -1)).join(' ').toLowerCase();
        const hit = findStructure(q || 'stone wall');
        if (!hit) return `No decay data for "${q}"`;
        if (hp === null) return `${hit.name}: ${hit.hp} HP decays fully in ${dur(hit.s * 1000)} without upkeep`;
        if (!pins) return 'Decay timers need a connected server';
        if (hp < 1 || hp > hit.hp) return `${hit.name} has ${hit.hp} HP max`;
        const me = team?.members?.find(m => String(m.steamId) === sender);
        const at = me && mapMeta ? { x: me.x, y: me.y } : {};
        const pin = pins.add({ kind: 'decay', name: hit.name, hp, ...at, label: `${hit.name} ${hp} HP` }, decayTable);
        pushPins?.();
        return `${hit.name} at ${hp}/${hit.hp} HP falls in ${dur(pin.end - Date.now())}${at.x != null ? ` · pinned at ${gridOf(at.x, at.y, mapMeta.mapSize)}` : ''}${q ? '' : ' (stone wall; say decay metal wall 400 for others)'}`;
    },

    decaylist: ({ pins, mapMeta }) => {
        const list = decayPins(pins);
        if (!list.length) return 'No decay timers. Add one: decay <HP> or decay <structure> <HP>';
        return list.map((p, i) => `${i + 1}) ${p.name}${p.x != null && mapMeta ? ` @ ${gridOf(p.x, p.y, mapMeta.mapSize)}` : ''}: ${p.end > Date.now() ? `falls in ${dur(p.end - Date.now())}` : 'should be down'}`).join(' | ');
    },

    cleardecay: ({ pins, pushPins }, args) => {
        const list = decayPins(pins);
        if (!list.length) return 'No decay timers to clear';
        const n = Number(args[0]);
        const gone = args.length ? (Number.isInteger(n) && list[n - 1] ? [list[n - 1]] : []) : list;
        if (!gone.length) return `No timer #${args[0]}. Use decaylist to see the numbers`;
        for (const p of gone) pins.remove(p.id);
        pushPins?.();
        return gone.length === 1 ? `Cleared ${gone[0].name}` : `Cleared ${gone.length} decay timers`;
    },

    raid: (ctx, args) => {
        if (!args.length) return 'Usage: raid <target> [amount], e.g. raid stone wall 2';
        const [q, n] = splitQty(args);
        const ql = q.toLowerCase();
        const t = RAID.targets.find(x => x.name.toLowerCase() === ql) || RAID.targets.find(x => x.name.toLowerCase().includes(ql));
        if (!t) return `Unknown target "${q}"`;
        const opts = Object.entries(t.costs)
            .filter(([k]) => k !== 'f1')
            .map(([k, c]) => [k, c.qty * n, c.qty * n * RAID.tools[k].sulfur])
            .sort((a, b) => a[2] - b[2]);
        return `${n}x ${t.name}: ${opts.slice(0, 4).map(([k, q2, s]) => `${q2} ${RAID.tools[k].name.replace('Timed Explosive Charge', 'C4').replace('Explosive 5.56 Rifle Ammo', 'Explo')} (${s})`).join(', ')}`;
    },

    upkeep: ({ devices }) => {
        const tcs = Object.values(devices.list).filter(d => d.type === 'monitor' && d.hasProtection);
        if (!tcs.length) return 'No TC storage monitors paired';
        return tcs.map(d => `${d.name}: ${d.protectionExpiry ? dur(d.protectionExpiry * 1000 - Date.now()) : 'DECAYING'}`).join(' | ');
    },

    alarms: ({ devices }) => {
        const al = Object.values(devices.list).filter(d => d.type === 'alarm');
        return al.length ? al.map(d => `${d.name}: ${d.lastTrigger ? `${dur(Date.now() - d.lastTrigger)} ago` : 'never'}`).join(' | ') : 'No alarms paired';
    },

    sw: async ({ devices, setSwitch }, args) => {
        const state = args[args.length - 1]?.toLowerCase();
        if (!['on', 'off'].includes(state)) return 'Usage: sw <name> on|off';
        const q = args.slice(0, -1).join(' ').toLowerCase();
        const sw = Object.values(devices.list).find(d => d.type === 'switch' && d.name.toLowerCase().includes(q));
        if (!sw) return `No switch matching "${q}"`;
        await setSwitch(sw.id, state === 'on');
        return `${sw.name} turned ${state}`;
    }
};

const STRUCTURE_ALIASES = { wood: 'wooden wall', wooden: 'wooden wall', stone: 'stone wall', metal: 'metal wall', sheet: 'metal wall', armored: 'armored wall', armoured: 'armored wall', hqm: 'armored wall', twig: 'twig wall' };
function findStructure(q) {
    q = STRUCTURE_ALIASES[q] || q.replace('armoured', 'armored');
    const n = d => d.name.toLowerCase();
    return GAME.decay.find(d => n(d) === q) || GAME.decay.find(d => n(d).startsWith(q)) || GAME.decay.find(d => n(d).includes(q));
}
const decayPins = pins => (pins?.list || []).filter(p => p.kind === 'decay').sort((a, b) => a.end - b.end);

async function handle(text, prefix, ctx) {
    if (!text.startsWith(prefix)) return null;
    const [cmd, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const fn = COMMANDS[cmd?.toLowerCase()];
    if (!fn) return null;
    if (PRO.has(cmd.toLowerCase()) && !ctx.isPro) return `!${cmd.toLowerCase()} is a RustScout Pro command (rust-scout.app)`;
    try {
        return await fn(ctx, args.filter(Boolean));
    } catch (e) {
        return `Error: ${e.message}`;
    }
}

module.exports = { handle, findItem, COMMANDS: Object.keys(COMMANDS) };
