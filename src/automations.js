const { Persisted } = require('./persist');

const TRIGGERS = ['manual', 'night', 'day', 'time', 'teamOffline', 'teamOnline', 'alarm'];

class Automations {
    constructor(file) {
        this.store = new Persisted(file, { rules: [] });
        this.prev = {};
    }

    get rules() {
        return this.store.data.rules;
    }

    set(rules) {
        if (!Array.isArray(rules)) throw new Error('Expected a list of automations');
        const old = new Map(this.rules.map(r => [r.id, r]));
        const seen = new Set();
        this.store.data.rules = rules.slice(0, 30).map(r => {
            const trigger = TRIGGERS.includes(r.trigger?.type) ? r.trigger.type : 'manual';
            const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(r.trigger?.at) ? r.trigger.at : '20:00';
            const id = typeof r.id === 'string' && /^[\w-]{1,24}$/.test(r.id) && !seen.has(r.id) ? r.id : Math.random().toString(36).slice(2, 10);
            seen.add(id);
            return {
                id,
                name: String(r.name || 'Automation').slice(0, 40),
                enabled: r.enabled !== false,
                trigger: { type: trigger, at, alarmId: String(r.trigger?.alarmId || 'any').replace(/[^\d]/g, '') || 'any' },
                action: { value: !!r.action?.value, ids: [...new Set((r.action?.ids || []).map(String).filter(x => /^\d+$/.test(x)))].slice(0, 20) },
                lastRun: old.get(id)?.lastRun ?? null
            };
        });
        this.store.flush();
        return this.rules;
    }

    matching(type, extra = {}) {
        return this.rules.filter(r => r.enabled && r.trigger.type === type && r.action.ids.length
            && (type !== 'alarm' || r.trigger.alarmId === 'any' || r.trigger.alarmId === String(extra.alarmId)));
    }

    changed(key, value) {
        const before = this.prev[key];
        this.prev[key] = value;
        return before !== undefined && before !== value;
    }

    dueAtClock(now = new Date()) {
        const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const day = now.toDateString();
        return this.matching('time').filter(r => r.trigger.at === hm && r.lastRun?.day !== day);
    }

    record(rule, result, now = new Date()) {
        const r = this.rules.find(x => x.id === rule.id);
        if (!r) return;
        r.lastRun = { t: now.getTime(), day: now.toDateString(), ...result };
        this.store.flush();
    }
}

module.exports = { Automations, TRIGGERS };
