const { Persisted } = require('./persist');

const TYPES = { 1: 'switch', 2: 'alarm', 3: 'monitor' };

class Devices {
    constructor(file) {
        this.store = new Persisted(file, { list: {} });
    }

    get list() {
        return this.store.data.list;
    }

    get(entityId) {
        const id = String(entityId);
        return /^\d+$/.test(id) && Object.hasOwn(this.list, id) ? this.list[id] : null;
    }

    add(entityId, entityType, name) {
        const id = String(entityId);
        if (!/^\d+$/.test(id)) throw new Error('Bad device id');
        const existing = this.get(id);
        this.list[id] = {
            id,
            type: TYPES[entityType] || existing?.type || 'switch',
            name: existing?.name || name || TYPES[entityType] || 'Device',
            value: existing?.value ?? false,
            reachable: existing?.reachable ?? true,
            items: existing?.items ?? [],
            capacity: existing?.capacity ?? 0,
            hasProtection: existing?.hasProtection ?? false,
            protectionExpiry: existing?.protectionExpiry ?? 0,
            lastTrigger: existing?.lastTrigger ?? null,
            rules: existing?.rules ?? []
        };
        this.store.flush();
        return this.list[id];
    }

    apply(entityId, payload, now = Date.now()) {
        const d = this.get(entityId);
        if (!d) return false;
        const wasOn = d.value;
        d.reachable = true;
        d.value = !!payload.value;
        if (d.type === 'monitor') {
            d.items = (payload.items || []).map(i => ({ itemId: i.itemId, quantity: i.quantity, bp: !!i.itemIsBlueprint }));
            d.capacity = payload.capacity || 0;
            d.hasProtection = !!payload.hasProtection;
            d.protectionExpiry = payload.protectionExpiry || 0;
        }
        const triggered = d.type === 'alarm' && d.value && !wasOn;
        if (triggered) d.lastTrigger = now;
        this.store.touch();
        return triggered;
    }

    setRules(entityId, rules) {
        const d = this.get(entityId);
        if (!d || d.type !== 'monitor' || !Array.isArray(rules)) return null;
        d.rules = rules.slice(0, 20).map(r => ({
            itemId: String(r.itemId).replace(/[^\d-]/g, '').slice(0, 12),
            op: r.op === 'above' ? 'above' : 'below',
            qty: Math.max(0, Math.min(1e7, Math.round(Number(r.qty) || 0))),
            fired: false
        })).filter(r => r.itemId);
        this.store.flush();
        return d.rules;
    }

    checkRules(entityId) {
        const d = this.get(entityId);
        if (!d || d.type !== 'monitor' || !d.reachable) return [];
        const hits = [];
        for (const r of d.rules || []) {
            const have = d.items.filter(i => String(i.itemId) === r.itemId && !i.bp).reduce((s, i) => s + i.quantity, 0);
            const met = r.op === 'below' ? have < r.qty : have > r.qty;
            if (met && !r.fired) hits.push({ ...r, have });
            if (met !== r.fired) { r.fired = met; this.store.touch(); }
        }
        return hits;
    }

    markUnreachable(entityId) {
        const d = this.get(entityId);
        if (d) {
            d.reachable = false;
            this.store.touch();
        }
    }

    rename(entityId, name) {
        const d = this.get(entityId);
        if (!d) return false;
        d.name = String(name).slice(0, 40);
        this.store.flush();
        return true;
    }

    remove(entityId) {
        if (this.get(entityId)) delete this.list[String(entityId)];
        this.store.flush();
    }
}

module.exports = { Devices };
