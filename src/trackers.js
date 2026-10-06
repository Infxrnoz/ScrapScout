const { Persisted } = require('./persist');
const { describe } = require('./geo');

class TeamTracker {
    constructor(file) {
        this.store = new Persisted(file, { deaths: [], log: [], members: {} });
        this.prev = null;
    }

    update(team, now, mapMeta) {
        const out = [];
        const members = team?.members || [];
        const prev = this.prev;
        this.prev = Object.fromEntries(members.map(m => [m.steamId, m]));
        if (!prev) return out;

        for (const m of members) {
            const before = prev[m.steamId];
            const rec = this.store.data.members[m.steamId] ??= { name: m.name, deaths: 0, onlineSince: null, lastOnline: null };
            rec.name = m.name;
            if (m.isOnline) rec.lastOnline = now;
            if (!before) continue;

            if (!before.isOnline && m.isOnline) {
                rec.onlineSince = now;
                out.push({ kind: 'teamOnline', name: m.name, steamId: m.steamId, text: `${m.name} came online` });
            }
            if (before.isOnline && !m.isOnline) {
                rec.onlineSince = null;
                out.push({ kind: 'teamOffline', name: m.name, steamId: m.steamId, text: `${m.name} went offline` });
            }
            if (before.isAlive && !m.isAlive) {
                const x = m.x || before.x;
                const y = m.y || before.y;
                const where = describe(x, y, mapMeta);
                rec.deaths++;
                this.store.data.deaths.push({ t: now, steamId: m.steamId, name: m.name, x, y, where, alive: before.spawnTime ? now / 1000 - before.spawnTime : null });
                this.store.data.deaths = this.store.data.deaths.slice(-300);
                out.push({ kind: 'teamDeath', name: m.name, steamId: m.steamId, x, y, text: `${m.name} died at ${where}` });
            }
            if (!before.isAlive && m.isAlive && m.isOnline) {
                out.push({ kind: 'teamRespawn', name: m.name, steamId: m.steamId, text: `${m.name} respawned` });
            }
        }

        if (out.length) {
            this.store.data.log.push(...out.map(e => ({ t: now, kind: e.kind, text: e.text })));
            this.store.data.log = this.store.data.log.slice(-500);
            this.store.touch();
        }
        return out;
    }
}

class PopTracker {
    constructor(file) {
        this.store = new Persisted(file, { samples: [] });
    }

    add(info, now) {
        const s = this.store.data.samples;
        if (s.length && now - s[s.length - 1][0] < 60000) return;
        s.push([now, info.players, info.queuedPlayers || 0, info.maxPlayers]);
        const cutoff = now - 7 * 86400e3;
        while (s.length && s[0][0] < cutoff) s.shift();
        this.store.touch();
    }
}

module.exports = { TeamTracker, PopTracker };
