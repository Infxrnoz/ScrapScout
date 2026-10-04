const ITEMS = require('../data/items.json');
const GAME = require('../data/game.json');
const RAID = require('../data/raid.json');
const { gridOf } = require('./geo');
const { EVENT_NAMES } = require('./trackers');

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

const NO_MARKERS = 'Facepunch removed shops/events from Rust+ (6 Aug 2026)';
const markersGone = markers => !markers.some(m => m.type !== 1);

const COMMANDS = {
    help: () => `Commands: ${Object.keys(COMMANDS).filter(c => c !== 'help').join(' ')}`,

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

    events: ({ events, markers }) => {
        if (markersGone(markers)) return NO_MARKERS;
        const snap = events.snapshot();
        const active = snap.active.filter(e => e.type !== 'explosion').map(e => `${EVENT_NAMES[e.type]} @ ${e.where} (${dur(Date.now() - e.since)})`);
        return active.length ? active.join(' | ') : 'No events active';
    },

    cargo: ctx => eventStatus(ctx, 'cargo'),
    heli: ctx => eventStatus(ctx, 'heli'),
    chinook: ctx => eventStatus(ctx, 'ch47'),
    vendor: ctx => eventStatus(ctx, 'vendor'),

    crate: ({ events, markers }) => {
        if (markersGone(markers)) return NO_MARKERS;
        const crates = events.snapshot().active.filter(e => e.type === 'crate');
        if (!crates.length) return 'No locked crates on the map';
        const at = {};
        for (const c of crates) at[c.where || '?'] = (at[c.where || '?'] || 0) + 1;
        const newest = Math.max(...crates.map(c => c.since));
        return `Locked Crates: ${crates.length} on the map: ${Object.entries(at).map(([w, n]) => `${n} at ${w}`).join(', ')}; newest arrived ${dur(Date.now() - newest)} ago`;
    },

    oil: ({ events }) => `${events.rig('smallRig', 'Oil Rig')} | ${events.rig('largeRig', 'Large Oil Rig')}`,
    small: ({ events }) => events.rig('smallRig', 'Oil Rig'),
    large: ({ events }) => events.rig('largeRig', 'Large Oil Rig'),

    airdrop: ({ events, markers }) => {
        if (markersGone(markers)) return NO_MARKERS;
        const snap = events.snapshot();
        const live = snap.active.find(e => e.type === 'plane');
        if (live) return `Airdrop plane is over the map${live.from ? `, came in from the ${live.from}` : ''} (${dur(Date.now() - live.since)} ago)`;
        const last = snap.last.plane;
        return last?.spawn ? `No airdrop plane right now. Last one came ${dur(Date.now() - last.spawn)} ago` : 'No airdrop seen yet';
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

    decay: (ctx, args) => {
        if (!args.length) return 'Usage: decay <structure>, e.g. decay stone wall';
        const q = args.join(' ').toLowerCase();
        const hit = GAME.decay.find(d => d.name.toLowerCase() === q) || GAME.decay.find(d => d.name.toLowerCase().includes(q));
        return hit ? `${hit.name}: ${hit.hp} HP decays fully in ${dur(hit.s * 1000)} without upkeep` : `No decay data for "${q}"`;
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

    shop: ({ markers, mapMeta }, args) => {
        const q = args.join(' ');
        const id = findItem(q);
        if (!id) return `Unknown item "${q}"`;
        if (markersGone(markers)) return NO_MARKERS;
        const offers = [];
        for (const vm of markers.filter(m => m.type === 3)) {
            for (const o of vm.sellOrders || []) {
                if (String(o.itemId) === id && o.amountInStock > 0) offers.push({ vm, o, unit: o.costPerItem / o.quantity });
            }
        }
        if (!offers.length) return `Nobody sells ${name(id)} right now`;
        offers.sort((a, b) => a.unit - b.unit);
        return `${name(id)}: ` + offers.slice(0, 3).map(({ vm, o }) =>
            `${o.quantity} for ${o.costPerItem} ${name(o.currencyId)} @ ${mapMeta ? gridOf(vm.x, vm.y, mapMeta.mapSize) : '?'}`).join(' | ');
    },

    sulfur: ({ tracker, markers }) => {
        if (markersGone(markers)) return NO_MARKERS;
        const top = tracker.targets(6).filter(t => t.sulfurCollected > 0).slice(0, 3);
        return top.length ? 'Sulfur shops (6h): ' + top.map(t => `${t.name || 'shop'} ${t.sulfurCollected}`).join(' | ') : 'No sulfur sales tracked in 6h';
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

function eventStatus({ events, markers }, type) {
    if (markersGone(markers)) return NO_MARKERS;
    const snap = events.snapshot();
    const live = snap.active.find(e => e.type === type);
    if (live) return `${EVENT_NAMES[type]} is up at ${live.where} (${dur(Date.now() - live.since)})`;
    const last = snap.last[type];
    if (last?.despawn) return `${EVENT_NAMES[type]} not up. Last left ${dur(Date.now() - last.despawn)} ago`;
    return `${EVENT_NAMES[type]} not seen yet`;
}

async function handle(text, prefix, ctx) {
    if (!text.startsWith(prefix)) return null;
    const [cmd, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const fn = COMMANDS[cmd?.toLowerCase()];
    if (!fn) return null;
    try {
        return await fn(ctx, args.filter(Boolean));
    } catch (e) {
        return `Error: ${e.message}`;
    }
}

module.exports = { handle, findItem, COMMANDS: Object.keys(COMMANDS) };
