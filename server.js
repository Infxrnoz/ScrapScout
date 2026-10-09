const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const RustPlus = require('@liamcottle/rustplus.js');
const PushReceiverClient = require('@liamcottle/push-receiver/src/client');
const { TeamTracker, PopTracker } = require('./src/trackers');
const { Devices } = require('./src/devices');
const { Persisted } = require('./src/persist');
const { Pins } = require('./src/pins');
const geo = require('./src/geo');
const { DiscordBot } = require('./src/discord');
const chatbot = require('./src/chatbot');
const steam = require('./src/steam');
const browser = require('./src/browser');
const rustmaps = require('./src/rustmaps');
const terrain = require('./src/terrain');
const { Tracking } = require('./src/tracking');
const { Automations } = require('./src/automations');
const { PhoneServer } = require('./src/phone');

const ROOT = __dirname;
const STATIC = path.join(ROOT, 'data');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : STATIC;
const CONFIG_FILE = process.env.CONFIG_FILE ? path.resolve(process.env.CONFIG_FILE) : path.join(ROOT, 'config.json');
const CREDS_FILE = process.env.RUSTPLUS_CONFIG ? path.resolve(process.env.RUSTPLUS_CONFIG) : path.join(ROOT, 'rustplus.config.json');
const SERVERS_FILE = path.join(DATA, 'servers.json');

const ALERT_KINDS = {
    teamDeath: 'Teammate died', teamOnline: 'Teammate online', teamOffline: 'Teammate offline', teamRespawn: 'Teammate respawned',
    killedBy: 'You were killed', alarm: 'Smart alarm', chat: 'Team chat', upkeep: 'TC upkeep low', watchWipe: 'Watched server wiped',
    trackedOnline: 'Tracked player joined', trackedOffline: 'Tracked player left', decay: 'Decay timer', storage: 'Storage alert', automation: 'Automation ran'
};
const DEFAULT_ALERTS = Object.fromEntries(Object.keys(ALERT_KINDS).map(k => [k, {
    toast: !['teamRespawn', 'chat'].includes(k),
    discord: ['teamDeath', 'killedBy', 'alarm', 'upkeep', 'watchWipe', 'trackedOnline', 'trackedOffline', 'decay', 'storage'].includes(k)
}]));

const DEFAULT_CONFIG = {
    port: 3000,
    credentialsFile: '',
    steamId: '',
    poll: { team: 5000, time: 15000, info: 30000, devices: 60000 },
    steamApiKey: '',
    rustMapsKey: '',
    licenseKey: '',
    licenseActivation: '',
    discordWebhook: '',
    bot: { enabled: true, prefix: '!' },
    discordBot: { enabled: false, token: '', channelId: '', prefix: '!', allowSay: false },
    upkeepAlertHours: 3,
    decayAlertMinutes: 30,
    escalation: { enabled: false, repeatMinutes: 2, maxRepeats: 5, mention: '@here', sound: true },
    phone: { enabled: false, token: '' },
    alerts: DEFAULT_ALERTS
};

const readJson = (file, fallback, { keepBad = false } = {}) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        if (keepBad && e.code !== 'ENOENT') {
            const bad = `${file}.bad-${Date.now()}`;
            try { fs.renameSync(file, bad); } catch {  }
            console.error(`${path.basename(file)} could not be read (${e.message}); saved it as ${path.basename(bad)} and started from defaults`);
        }
        return fallback;
    }
};
const writeJson = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
};

if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, DEFAULT_CONFIG);
const loaded = readJson(CONFIG_FILE, {}, { keepBad: true });
const config = {
    ...DEFAULT_CONFIG, ...loaded,
    poll: { ...DEFAULT_CONFIG.poll, ...loaded.poll },
    bot: { ...DEFAULT_CONFIG.bot, ...loaded.bot },
    discordBot: { ...DEFAULT_CONFIG.discordBot, ...loaded.discordBot },
    escalation: { ...DEFAULT_CONFIG.escalation, ...loaded.escalation },
    phone: { ...DEFAULT_CONFIG.phone, ...loaded.phone },
    alerts: Object.fromEntries(Object.keys(ALERT_KINDS).map(k => [k, { ...DEFAULT_ALERTS[k], ...loaded.alerts?.[k] }]))
};
const saveConfig = () => writeJson(CONFIG_FILE, { ...config, port: loaded.port ?? config.port });
if (process.env.PORT) config.port = Number(process.env.PORT);

const store = readJson(SERVERS_FILE, { active: null, list: {} }, { keepBad: true });
const saveStore = () => writeJson(SERVERS_FILE, store);
const threats = new Persisted(path.join(DATA, 'threats.json'), { deaths: [] });

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const serverDir = id => path.join(DATA, 'servers', id.replace(/[^\w.-]/g, '_'));

const plain = value => value.constructor.toObject(value, { defaults: true, arrays: true, longs: String, enums: Number });
const errText = e => e?.message || (typeof e === 'object' ? JSON.stringify(e) : String(e));

const app = express();
const httpServer = http.createServer(app);
const LOCAL = host => /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host || '');
const fromApp = req => {
    if (!LOCAL(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return LOCAL(new URL(origin).host); } catch { return false; }
};
const wss = new WebSocketServer({ server: httpServer, path: '/ws', verifyClient: ({ req }) => fromApp(req) });
wss.on('error', () => {});

const phone = new PhoneServer({
    root: path.join(ROOT, 'public'), leafletDir: path.join(ROOT, 'node_modules', 'leaflet', 'dist'), log,
    mapFile: () => session && fs.existsSync(path.join(serverDir(session.server.id), 'map.jpg')) ? path.join(serverDir(session.server.id), 'map.jpg') : null,
    pop: () => session ? session.pop.store.data.samples : [],
    snapshot: () => session?.snapshot() ?? null
});

const broadcast = msg => {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send(text);
    phone.send(text);
};

let discordBot = null;

const ITEMS = readJson(path.join(STATIC, 'items.json'), {});
const ALERT_COLORS = { storage: 0xe4a73a, teamDeath: 0xd8412f, killedBy: 0xd8412f, alarm: 0xff3b30, teamOnline: 0x7cc043, teamOffline: 0x8d8a85, sulfurSale: 0xf07a2c, upkeep: 0xe4a73a };

function alert(kind, text, extra = {}) {
    const rule = config.alerts[kind];
    if (!rule) return;
    const entry = { kind, label: ALERT_KINDS[kind], text, t: Date.now(), server: session?.server.name, ...extra };
    broadcast({ type: 'alert', alert: entry, toast: rule.toast });
    if (kind === 'alarm' && escalate(text, entry.server)) return;
    if (rule.discord && isPro()) discordSend(ALERT_KINDS[kind], text, ALERT_COLORS[kind], entry.server);
}

function mentionFor(m) {
    m = String(m || '').trim();
    if (m === '@here' || m === '@everyone') return { content: m, allowed: { parse: ['everyone'] } };
    const role = /^<@&(\d{15,25})>$/.exec(m), user = /^<@!?(\d{15,25})>$/.exec(m);
    if (role) return { content: m, allowed: { parse: [], roles: [role[1]] } };
    if (user) return { content: m, allowed: { parse: [], users: [user[1]] } };
    return null;
}

function discordSend(title, text, color = 0x3fa9f5, server, ping) {
    const embed = { title, description: text, color, footer: server ? { text: server } : undefined };
    if (config.discordWebhook) {
        fetch(config.discordWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'RustScout', content: ping?.content, allowed_mentions: ping ? ping.allowed : { parse: [] },
                embeds: [{ ...embed, timestamp: new Date().toISOString() }]
            }),
            signal: AbortSignal.timeout(8000)
        }).catch(e => log('webhook failed:', e.message));
    } else if (discordBot?.user) {
        discordBot.post(embed, undefined, ping).catch(e => log('discord bot alert failed:', e.message));
    }
}

const escalation = { active: null, timer: null };

function escalate(text, server) {
    const e = config.escalation;
    if (!e.enabled || !isPro()) return false;
    if (escalation.active) {
        escalation.active.text = text;
        broadcast({ type: 'escalation', escalation: escalation.active });
        return true;
    }
    escalation.active = { text, server, startedAt: Date.now(), count: 0, sound: e.sound };
    ring();
    return true;
}

function ring() {
    const a = escalation.active;
    if (!a) return;
    a.count++;
    a.nextAt = a.count < config.escalation.maxRepeats ? Date.now() + config.escalation.repeatMinutes * 60e3 : null;
    broadcast({ type: 'escalation', escalation: a });
    const how = `Answer with **${config.bot.prefix}ack** in team chat${discordBot?.user ? `, **${config.discordBot.prefix}ack** here` : ''} or **I'm on it** in RustScout.`;
    discordSend(`🚨 Raid alarm${a.count > 1 ? ` (reminder ${a.count - 1})` : ''}`, `${a.text}\n${how}`, 0xff3b30, a.server, mentionFor(config.escalation.mention));
    if (a.nextAt) escalation.timer = setTimeout(ring, a.nextAt - Date.now());
}

function acknowledge(by) {
    if (!escalation.active) return false;
    clearTimeout(escalation.timer);
    escalation.active = null;
    broadcast({ type: 'escalation', escalation: null, by });
    discordSend('✅ On it', `${by} answered the raid alarm.`, 0x7fd04a);
    log(`raid alarm answered by ${by}`);
    return true;
}

const NOT_LINKED = process.env.DESKTOP ? 'not set up — link your Steam account' : 'not set up — run setup.bat (or npm run register) to link Steam';
const fcm = { status: NOT_LINKED, client: null };

function loadGcmCredentials() {
    const local = CREDS_FILE;
    const file = fs.existsSync(local) ? local : config.credentialsFile ? path.resolve(ROOT, config.credentialsFile) : null;
    if (!file) return null;
    const creds = readJson(file, null);
    if (!creds) throw new Error(`cannot read ${file}`);
    const expiry = creds[creds.hoster]?.expire_date;
    if (expiry && Number(expiry) * 1000 < Date.now()) {
        throw new Error(`pairing credentials expired ${new Date(Number(expiry) * 1000).toDateString()} — run "npx rustplus fcm-register" in the app folder`);
    }

    if (creds.fcm_credentials) {
        const gcm = creds.fcm_credentials.gcm;
        return { androidId: gcm.androidId ?? gcm.android_id, securityToken: gcm.securityToken ?? gcm.security_token };
    }
    const user = creds[config.steamId || creds.hoster];
    if (!user?.gcm) throw new Error(`no gcm credentials for ${config.steamId || creds.hoster || 'hoster'} in ${file}`);
    return { androidId: user.gcm.android_id, securityToken: user.gcm.security_token };
}

function onPush(data) {
    const get = key => data.appData?.find(i => i.key === key)?.value;
    const channel = get('channelId');
    const title = get('title') || '';
    const message = get('message') || '';
    let body = {};
    try { body = JSON.parse(get('body') || '{}'); } catch {  }
    const serverId = body.ip && body.port ? `${body.ip}:${body.port}` : null;
    log(`push received: ${channel || '?'}${body.type ? `/${body.type}` : ''} ${title}`.trim());

    if (channel === 'pairing' && body.type === 'server') {
        store.list[serverId] = {
            id: serverId, name: body.name, ip: body.ip, port: Number(body.port),
            playerId: String(body.playerId), playerToken: String(body.playerToken),
            img: body.img, url: body.url, desc: body.desc
        };
        log(`paired server ${body.name} (${serverId})`);
        saveStore();
        broadcast({ type: 'servers', servers: publicServers() });
        activate(serverId);
        return;
    }

    if (channel === 'pairing' && body.type === 'entity') {
        log(`paired ${body.entityName} ${body.entityId} on ${serverId}`);
        if (session?.server.id === serverId) {
            session.devices.add(body.entityId, Number(body.entityType), body.entityName);
            session.refreshDevice(body.entityId).catch(() => {});
            session.pushDevices();
        } else {
            const devices = new Devices(path.join(serverDir(serverId), 'devices.json'));
            devices.add(body.entityId, Number(body.entityType), body.entityName);
            devices.store.flush();
        }
        return;
    }

    if (channel === 'player' && body.type === 'death') {
        const killerName = title.match(/killed by (.+)$/i)?.[1]?.trim() || body.targetName || 'Unknown';
        threats.data.deaths.push({ t: Date.now(), killerId: body.targetId || '', killerName, server: body.name || null, title });
        threats.data.deaths = threats.data.deaths.slice(-1000);
        threats.touch();
        alert('killedBy', title || `Killed by ${killerName}`, { killerId: body.targetId || null });
        broadcast({ type: 'threatsChanged' });
        return;
    }

    if (channel === 'alarm' && serverId !== session?.server.id) {
        alert('alarm', `${title}${message ? ` — ${message}` : ''}${body.name ? ` (${body.name})` : ''}`);
    }
}

async function startFcm() {
    if (fcm.client) {
        fcm.client.destroy();
        fcm.client = null;
        fcm.status = NOT_LINKED;
    }
    if (process.env.NO_FCM) {
        fcm.status = 'disabled (NO_FCM)';
        return;
    }
    let gcm;
    try {
        gcm = loadGcmCredentials();
    } catch (e) {
        fcm.status = e.message;
        log('fcm:', e.message);
        return;
    }
    if (!gcm) return;

    const seen = new Persisted(path.join(DATA, 'fcm-seen.json'), { ids: [] });
    fcm.client = new PushReceiverClient(gcm.androidId, gcm.securityToken, [...seen.data.ids]);
    fcm.client.on('ON_DATA_RECEIVED', data => {
        if (data.persistentId) {
            if (seen.data.ids.includes(data.persistentId)) return;
            seen.data.ids = [...seen.data.ids, data.persistentId].slice(-200);
            seen.flush();
        }
        try { onPush(data); } catch (e) { log('push handling failed:', e.message); }
    });
    try {
        await fcm.client.connect();
        fcm.status = 'listening';
        log('fcm: listening for pairing, death and alarm notifications');
    } catch (e) {
        fcm.status = `failed: ${e.message}`;
        log('fcm connect failed:', e.message);
    }
}

const publicServers = () => ({
    active: store.active,
    fcm: fcm.status,
    list: Object.values(store.list).map(({ playerToken, ...s }) => s)
});

class Session {
    constructor(server) {
        this.server = server;
        this.state = { status: 'connecting', info: null, time: null, team: null, mapMeta: null };
        this.timers = [];
        this.timeSamples = [];
        this.chat = [];
        this.closed = false;
        const dir = serverDir(server.id);
        this.teamTracker = new TeamTracker(path.join(dir, 'team.json'));
        this.pop = new PopTracker(path.join(dir, 'pop.json'));
        this.devices = new Devices(path.join(dir, 'devices.json'));
        this.pins = new Pins(path.join(dir, 'pins.json'));
        this.automations = new Automations(path.join(dir, 'automations.json'));
        this.decayTimer = setInterval(() => { this.checkDecay(); this.runAutomations('time'); }, 30000);
        this.upkeepWarned = new Set();
        this.connect();
    }

    connect() {
        const s = this.server;
        this.rp = new RustPlus(s.ip, s.port, s.playerId, s.playerToken);
        this.rp.on('connected', () => {
            clearTimeout(this.connectTimer);
            this.handshaking = false;
            this.onConnected().catch(e => this.fail(e));
        });
        this.rp.on('disconnected', () => {
            clearTimeout(this.connectTimer);
            const neverConnected = this.handshaking;
            this.handshaking = false;
            if (neverConnected && !this.closed) this.setStatus('not answering');
            this.onDisconnected();
        });
        this.rp.on('error', e => log(`rust+ error (${s.name}):`, e.message));
        this.rp.on('message', msg => {
            try { this.onBroadcast(msg); } catch (e) { log('broadcast handling failed:', e.message); }
        });
        if (this.state.status !== 'not answering') this.setStatus('connecting');
        this.handshaking = true;
        this.rp.connect();
        clearTimeout(this.connectTimer);
        this.connectTimer = setTimeout(() => {
            if (this.closed || !this.handshaking) return;
            log(`${s.name}: Rust+ didn't answer within 30s`);
            this.setStatus('not answering');
            try { this.rp.disconnect(); } catch {  }
            this.onDisconnected();
        }, 30000);
    }

    setStatus(status) {
        this.state.status = status;
        broadcast({ type: 'status', status });
        if (status === 'not answering') this.loadFallbackMap();
    }

    async loadFallbackMap() {
        if (this.fallbackTried || this.state.mapMeta) return;
        this.fallbackTried = true;
        try {
            const sameName = d => d?.name === this.server.name;
            const onIp = await browser.resolve(this.server.ip).catch(() => []);
            const found = await Promise.all(onIp.map(x => browser.details(x.ip, x.queryPort).catch(() => null)));
            let d = found.find(sameName) || (found.filter(Boolean).length === 1 ? found.find(Boolean) : null);
            if (!d && config.steamApiKey) {
                const hit = (await browser.list(config.steamApiKey)).servers.find(sameName);
                if (hit) d = await browser.details(hit.ip, hit.queryPort).catch(() => null);
            }
            if (!d?.mapImage || this.closed || this.state.mapMeta) return;
            log(`${this.server.name}: Rust+ isn't answering, showing its map from Steam (${d.ip})`);
            this.state.fallback = d;
            broadcast({ type: 'fallback', fallback: d });
        } catch (e) { log('fallback map failed:', errText(e)); }
    }

    request(data) {
        if (this.closed || !this.rp.websocket) return Promise.reject(new Error('not connected'));
        return this.rp.sendRequestAsync(data, 15000);
    }

    async onConnected() {
        log(`connected to ${this.server.name}`);
        this.setStatus('loading map');
        await this.refreshInfo();
        await this.refreshMap();
        if (this.closed) return;
        this.setStatus('online');
        await Promise.allSettled([this.refreshTeam(), this.refreshTime(), this.loadChat(), this.refreshDevices()]);
        if (this.closed) return;
        this.every(config.poll.team, () => this.refreshTeam());
        this.every(config.poll.time, () => this.refreshTime());
        this.every(config.poll.info, () => this.refreshInfo());
        this.every(config.poll.devices, () => this.refreshDevices());
    }

    every(ms, fn) {
        this.timers.push(setInterval(() => {
            if (this.closed) return;
            fn().catch(e => !this.closed && log('poll failed:', errText(e)));
        }, ms));
    }

    clearTimers() {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }

    fail(e) {
        log(`session error (${this.server.name}):`, errText(e));
        this.setStatus(`error: ${errText(e)} — retrying`);
        if (this.closed) return;
        this.clearTimers();
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            if (this.closed) return;
            if (this.rp.websocket) this.rp.disconnect(); 
            else this.connect();
        }, 5000);
    }

    onDisconnected() {
        this.clearTimers();
        if (this.closed || this.reconnectPending) return;
        this.reconnectPending = true;
        if (this.state.status !== 'not answering') this.setStatus('reconnecting');
        log(`disconnected from ${this.server.name}, retrying in 15s`);
        setTimeout(() => { this.reconnectPending = false; if (!this.closed) this.connect(); }, 15000);
    }

    onBroadcast(msg) {
        const b = msg.broadcast;
        if (!b) return;
        if (b.teamMessage?.message) this.onTeamMessage(plain(b.teamMessage.message));
        if (b.entityChanged) {
            const { entityId, payload } = plain(b.entityChanged);
            const device = this.devices.get(entityId);
            if (!device) return;
            if (this.devices.apply(entityId, payload)) {
                alert('alarm', `${device.name} triggered`);
                this.runAutomations('alarm', { alarmId: entityId });
            }
            this.checkStorage(entityId);
            this.pushDevices();
        }
        if (b.teamChanged) this.refreshTeam().catch(() => {});
    }

    async refreshInfo() {
        const { info } = await this.request({ getInfo: {} });
        this.state.info = plain(info);
        this.pop.add(this.state.info, Date.now());
        if (this.server.name === this.server.id && info.name) {
            this.server.name = info.name;
            saveStore();
            broadcast({ type: 'servers', servers: publicServers() });
        }
        broadcast({ type: 'info', info: this.state.info });
    }

    async refreshMap() {
        const { map } = await this.request({ getMap: {} });
        const dir = serverDir(this.server.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'map.jpg'), map.jpgImage);
        this.state.mapMeta = {
            width: map.width, height: map.height, oceanMargin: map.oceanMargin,
            mapSize: this.state.info.mapSize, background: map.background,
            seed: this.state.info.seed, custom: !/^procedural map$/i.test(this.state.info.map || ''),
            monuments: map.monuments.map(m => ({ token: m.token, x: m.x, y: m.y })),
            version: Date.now()
        };
        await this.lookupWorldSeed();
        broadcast({ type: 'map', mapMeta: this.state.mapMeta });
    }

    async lookupWorldSeed() {
        try {
            const found = await browser.resolve(this.server.ip);
            const candidates = (await Promise.all(found.map(s => browser.details(s.ip, s.queryPort).catch(() => null))))
                .filter(d => d?.seed && d.size === this.state.info.mapSize);
            let d = candidates.find(c => c.name === this.state.info.name) || (candidates.length === 1 ? candidates[0] : null);
            if (!d && config.steamApiKey) {
                const cache = await browser.list(config.steamApiKey);
                const hit = cache.servers.find(s => s.name === this.state.info.name);
                if (hit) d = await browser.details(hit.ip, hit.queryPort).catch(() => null);
            }
            if (d) this.queryAddr = { ip: d.ip, queryPort: d.queryPort, gamePort: d.gamePort, name: d.name };
            if (d?.seed) {
                this.state.mapMeta.seed = d.seed;
                this.state.mapMeta.custom = d.customMap || this.state.mapMeta.custom;
                this.state.mapMeta.rustMapsId = d.rustMapsId;
                this.state.mapMeta.levelUrl = d.levelUrl;
                this.state.mapMeta.flags = d.flags || [];
            }
        } catch {  }
    }

    async refreshTeam() {
        const { teamInfo } = await this.request({ getTeamInfo: {} });
        this.state.team = plain(teamInfo);
        for (const e of this.teamTracker.update(this.state.team, Date.now(), this.state.mapMeta)) alert(e.kind, e.text, { x: e.x, y: e.y });
        const anyOnline = (this.state.team.members || []).some(m => m.isOnline);
        if (this.automations.changed('anyOnline', anyOnline)) this.runAutomations(anyOnline ? 'teamOnline' : 'teamOffline');
        broadcast({ type: 'team', team: this.state.team, teamLog: this.teamSnapshot() });
    }

    teamSnapshot() {
        const d = this.teamTracker.store.data;
        return { deaths: d.deaths.slice(-100), log: d.log.slice(-100).reverse(), members: d.members };
    }

    async refreshTime() {
        const { time } = await this.request({ getTime: {} });
        const now = Date.now();
        this.timeSamples.push({ at: now, time: time.time });
        this.timeSamples = this.timeSamples.filter(s => now - s.at < 120000).slice(-8);
        this.state.time = { ...plain(time), sampledAt: now, secondsPerHour: this.secondsPerGameHour(time) };
        const gt = this.gameTime();
        if (gt && this.automations.changed('isDay', gt.isDay)) this.runAutomations(gt.isDay ? 'day' : 'night');
        broadcast({ type: 'time', time: this.state.time });
    }

    secondsPerGameHour(time) {
        const [a, b] = [this.timeSamples[0], this.timeSamples[this.timeSamples.length - 1]];
        let dh = b ? b.time - a.time : 0;
        if (dh < 0) dh += 24;
        if (b && dh > 0.01 && b.at - a.at > 10000) return (b.at - a.at) / 1000 / dh;
        return (time.dayLengthMinutes * 60) / 24;
    }

    gameTime() {
        const t = this.state.time;
        if (!t) return null;
        const now = (t.time + (Date.now() - t.sampledAt) / 1000 / t.secondsPerHour) % 24;
        const isDay = now >= t.sunrise && now < t.sunset;
        let dh = (isDay ? t.sunset : t.sunrise) - now;
        if (dh < 0) dh += 24;
        const h = Math.floor(now), m = Math.floor((now - h) * 60);
        return { clock: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, isDay, untilChange: dh * t.secondsPerHour };
    }

    async loadChat() {
        const { teamChat } = await this.request({ getTeamChat: {} });
        this.chat = plain(teamChat).messages.slice(-200);
        broadcast({ type: 'chat', chat: this.chat });
    }

    async onTeamMessage(m) {
        this.chat.push(m);
        this.chat = this.chat.slice(-200);
        broadcast({ type: 'chatMessage', message: m });
        if (m.steamId !== this.server.playerId) alert('chat', `${m.name}: ${m.message}`);
        if (!config.bot.enabled) return;
        const reply = await chatbot.handle(m.message, config.bot.prefix, { ...this.botContext(), sender: String(m.steamId), senderName: m.name });
        if (reply) await this.say(reply);
    }

    botContext() {
        return {
            info: this.state.info, team: this.state.team, mapMeta: this.state.mapMeta, devices: this.devices,
            pins: this.pins, decayTable: decayTable(), pushPins: () => this.pushPins(),
            gameTime: () => this.gameTime(), isPro: isPro(), ack: by => acknowledge(by),
            setSwitch: (id, value) => this.setSwitch(id, value)
        };
    }

    async say(text) {
        const parts = [];
        let line = '';
        for (const word of String(text).split(' ')) {
            if ((line + ' ' + word).trim().length > 120) {
                parts.push(line.trim());
                line = '';
            }
            line += ' ' + word;
        }
        if (line.trim()) parts.push(line.trim());
        for (const p of parts) await this.request({ sendTeamMessage: { message: p } });
    }

    async refreshDevice(id) {
        try {
            const { entityInfo } = await this.request({ entityId: Number(id), getEntityInfo: {} });
            this.devices.apply(id, plain(entityInfo).payload);
            this.checkStorage(id);
        } catch {
            this.devices.markUnreachable(id);
        }
    }

    async refreshDevices() {
        for (const id of Object.keys(this.devices.list)) await this.refreshDevice(id);
        this.checkUpkeep();
        this.pushDevices();
    }

    checkUpkeep() {
        const limit = config.upkeepAlertHours * 3600e3;
        for (const d of Object.values(this.devices.list)) {
            if (d.type !== 'monitor' || !d.hasProtection) continue;
            const left = d.protectionExpiry * 1000 - Date.now();
            if (left < limit && !this.upkeepWarned.has(d.id)) {
                this.upkeepWarned.add(d.id);
                alert('upkeep', left <= 0 ? `${d.name} is DECAYING — no upkeep left` : `${d.name} upkeep runs out in ${Math.round(left / 60000)} minutes`);
            } else if (left >= limit) {
                this.upkeepWarned.delete(d.id);
            }
        }
    }

    checkStorage(id) {
        if (!isPro()) return;
        const d = this.devices.get(id);
        for (const r of this.devices.checkRules(id)) {
            alert('storage', `${d.name}: ${ITEMS[r.itemId]?.n || 'item'} is ${r.op} ${r.qty.toLocaleString()} (${r.have.toLocaleString()} now)`);
        }
    }

    checkDecay() {
        const due = this.pins.due(config.decayAlertMinutes * 60e3);
        for (const p of due) {
            const left = p.end - Date.now();
            const where = Number.isFinite(p.x) && this.state.mapMeta ? ` at ${geo.gridOf(p.x, p.y, this.state.mapMeta.mapSize)}` : '';
            alert('decay', `${p.label || p.name}${where} ${left > 0 ? `falls in ${Math.round(left / 60000)} minutes` : 'has decayed'}`);
        }
        if (due.length) this.pushPins();
    }

    runAutomations(type, extra) {
        if (!isPro() || this.closed) return;
        const list = type === 'time' ? this.automations.dueAtClock() : this.automations.matching(type, extra);
        for (const rule of list) this.runAutomation(rule).catch(e => log('automation failed:', errText(e)));
    }

    async runAutomation(rule) {
        const failed = [];
        for (const id of rule.action.ids) {
            if (this.devices.get(id)?.type !== 'switch') { failed.push(id); continue; }
            try { await this.setSwitch(id, rule.action.value); } catch { failed.push(id); }
        }
        this.automations.record(rule, { ok: !failed.length, failed });
        broadcast({ type: 'automations', automations: this.automations.rules });
        const done = rule.action.ids.length - failed.length;
        alert('automation', `${rule.name}: ${done} switch${done === 1 ? '' : 'es'} ${rule.action.value ? 'on' : 'off'}${failed.length ? `, ${failed.length} failed` : ''}`);
        return { done, failed };
    }

    pushPins() {
        broadcast({ type: 'pins', pins: this.pins.list });
    }

    async setSwitch(id, value) {
        await this.request({ entityId: Number(id), setEntityValue: { value: !!value } });
        await this.refreshDevice(id);
        this.pushDevices();
    }

    pushDevices() {
        broadcast({ type: 'devices', devices: Object.values(this.devices.list) });
    }

    snapshot() {
        return {
            server: { id: this.server.id, name: this.server.name, playerId: this.server.playerId },
            ...this.state,
            chat: this.chat,
            teamLog: this.teamSnapshot(),
            devices: Object.values(this.devices.list),
            pins: this.pins.list,
            automations: this.automations.rules
        };
    }

    close() {
        this.closed = true;
        this.clearTimers();
        clearTimeout(this.retryTimer);
        clearTimeout(this.connectTimer);
        clearInterval(this.decayTimer);
        for (const p of [this.teamTracker.store, this.pop.store, this.devices.store, this.pins.store, this.automations.store]) p.flush();
        try { this.rp.disconnect(); } catch {  }
    }
}

let session = null;

function activate(id) {
    if (!store.list[id]) return false;
    if (session && session.server.id === id && session.server.playerToken === store.list[id].playerToken && !session.closed) {
        session.server = store.list[id];
        broadcast({ type: 'servers', servers: publicServers() });
        return true;
    }
    session?.close();
    store.active = id;
    saveStore();
    session = new Session(store.list[id]);
    broadcast({ type: 'reset', snapshot: session.snapshot() });
    broadcast({ type: 'servers', servers: publicServers() });
    return true;
}

app.use((req, res, next) => fromApp(req) ? next() : res.status(403).end());
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules', 'leaflet', 'dist')));
for (const f of ['items.json', 'raid.json', 'game.json', 'ores.json']) app.get(`/data/${f}`, (req, res) => res.sendFile(path.join(STATIC, f)));

const needSession = (req, res, next) => session ? next() : res.status(409).json({ error: 'No server connected' });
const guard = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(500).json({ error: errText(e) }); }
};
const needPro = (req, res, next) => isPro() ? next() : res.status(402).json({ error: 'That’s a RustScout Pro feature', pro: true });
app.use(['/api/browse', '/api/watch', '/api/rustmaps', '/api/mapfile', '/api/mapfiles', '/api/terrain', '/api/facilities', '/api/tracked', '/api/rmtile', '/api/settings/test-webhook'], needPro);
app.use('/api/pins', (req, res, next) => ['POST', 'PUT'].includes(req.method) ? needPro(req, res, next) : next());

app.get('/api/map.jpg', (req, res) => {
    if (!session) return res.sendStatus(404);
    const file = path.join(serverDir(session.server.id), 'map.jpg');
    fs.existsSync(file) ? res.sendFile(file) : res.sendStatus(404);
});

app.get('/api/servers', (req, res) => res.json(publicServers()));

app.post('/api/servers', (req, res) => {
    const { name, ip, port, playerId, playerToken } = req.body || {};
    if (!ip || !port || !playerId || !playerToken) return res.status(400).json({ error: 'ip, port, playerId and playerToken are required' });
    const id = `${ip}:${port}`;
    store.list[id] = { id, name: name || id, ip, port: Number(port), playerId: String(playerId), playerToken: String(playerToken) };
    saveStore();
    activate(id);
    res.json(publicServers());
});

app.post('/api/servers/:id/activate', (req, res) =>
    activate(req.params.id) ? res.json(publicServers()) : res.sendStatus(404));

app.delete('/api/servers/:id', (req, res) => {
    const id = req.params.id;
    if (store.active === id) {
        session?.close();
        session = null;
        store.active = null;
        broadcast({ type: 'reset', snapshot: null });
    }
    delete store.list[id];
    saveStore();
    res.json(publicServers());
});

app.get('/api/pop', (req, res) => res.json(session ? session.pop.store.data.samples : []));

app.post('/api/chat', needSession, guard(async (req, res) => {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'empty message' });
    await session.say(message);
    res.json({ ok: true });
}));

app.post('/api/devices/:id/value', needSession, guard(async (req, res) => {
    await session.setSwitch(req.params.id, req.body?.value);
    res.json({ ok: true });
}));
app.post('/api/devices/refresh', needSession, guard(async (req, res) => {
    await session.refreshDevices();
    res.json({ ok: true });
}));
app.post('/api/devices', needSession, guard(async (req, res) => {
    const { entityId, type, name } = req.body || {};
    if (!/^\d+$/.test(String(entityId))) return res.status(400).json({ error: 'entityId must be a number' });
    session.devices.add(entityId, { switch: 1, alarm: 2, monitor: 3 }[type] || 1, name);
    await session.refreshDevice(entityId);
    session.pushDevices();
    res.json({ ok: true });
}));
app.get('/api/automations', needSession, (req, res) => res.json(session.automations.rules));
app.put('/api/automations', needSession, needPro, guard(async (req, res) => {
    const rules = session.automations.set(req.body?.rules);
    broadcast({ type: 'automations', automations: rules });
    res.json(rules);
}));
app.post('/api/automations/:id/run', needSession, needPro, guard(async (req, res) => {
    const rule = session.automations.rules.find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'No such automation' });
    res.json(await session.runAutomation(rule));
}));
app.put('/api/devices/:id/rules', needSession, needPro, (req, res) => {
    const rules = session.devices.setRules(req.params.id, req.body?.rules);
    if (!rules) return res.status(400).json({ error: 'Not a storage monitor' });
    session.checkStorage(req.params.id);
    session.pushDevices();
    res.json({ rules });
});
app.put('/api/devices/:id', needSession, (req, res) => {
    session.devices.rename(req.params.id, req.body?.name || 'Device');
    session.pushDevices();
    res.json({ ok: true });
});
app.delete('/api/devices/:id', needSession, (req, res) => {
    session.devices.remove(req.params.id);
    session.pushDevices();
    res.json({ ok: true });
});

const decayTable = () => require(path.join(STATIC, 'game.json')).decay;
const pinRoute = fn => (req, res) => {
    try {
        res.json(fn(req));
        session.pushPins();
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
};
app.get('/api/pins', needSession, (req, res) => res.json(session.pins.list));
app.post('/api/pins', needSession, pinRoute(req => session.pins.add(req.body || {}, decayTable())));
app.put('/api/pins/:id', needSession, pinRoute(req => session.pins.update(req.params.id, req.body || {}, decayTable())));
app.delete('/api/pins/:id', needSession, pinRoute(req => { session.pins.remove(req.params.id); return { ok: true }; }));

app.get('/api/threats', guard(async (req, res) => {
    const byKiller = {};
    for (const d of threats.data.deaths) {
        if (!d.killerId) continue;
        const k = byKiller[d.killerId] ??= { killerId: d.killerId, name: d.killerName, kills: 0, last: 0, first: d.t, servers: new Set() };
        k.kills++;
        k.last = Math.max(k.last, d.t);
        k.name = d.killerName;
        if (d.server) k.servers.add(d.server);
    }
    const list = Object.values(byKiller).sort((a, b) => b.kills - a.kills || b.last - a.last).slice(0, 50);
    for (const k of list) k.servers = [...k.servers];
    if (!isPro()) return res.json({ killers: list, recent: threats.data.deaths.slice(-50).reverse(), apiKey: !!config.steamApiKey, pro: false });
    await Promise.all(list.map(async k => {
        if (k.killerId) k.profile = await steam.profile(k.killerId, config.steamApiKey);
    }));
    const live = await steam.summaries(list.map(k => k.killerId), config.steamApiKey).catch(() => ({}));
    for (const k of list) {
        const p = live[k.killerId];
        k.status = !p ? null : p.gameId === '252490' ? 'rust' : p.state > 0 ? 'steam' : 'offline';
    }
    res.json({ killers: list, recent: threats.data.deaths.slice(-50).reverse(), apiKey: !!config.steamApiKey, pro: true });
}));

const watch = new Persisted(path.join(DATA, 'watch.json'), { list: {}, pop: {} });

const pairedFor = ip => Object.values(store.list).find(s => s.ip === ip)?.id ?? null;

async function pollWatched() {
    for (const w of Object.values(watch.data.list)) {
        try {
            const d = await browser.details(w.ip, w.queryPort);
            const samples = watch.data.pop[w.id] ??= [];
            samples.push([Date.now(), d.players, d.queued, d.maxPlayers]);
            while (samples.length > 7 * 24 * 20) samples.shift(); 
            if (w.wipe && d.wipe && d.wipe !== w.wipe) alert('watchWipe', `${d.name} just wiped (${d.players}/${d.maxPlayers} on)`);
            Object.assign(w, { name: d.name, wipe: d.wipe, players: d.players, maxPlayers: d.maxPlayers, queued: d.queued, online: true, checked: Date.now() });
        } catch {
            w.online = false;
            w.checked = Date.now();
        }
    }
    watch.touch();
    broadcast({ type: 'watch' });
}
setInterval(pollWatched, 3 * 60e3);

const withPaired = s => ({ ...s, paired: pairedFor(s.ip), watched: !!watch.data.list[s.id] });

app.get('/api/browse/list', guard(async (req, res) => {
    const q = req.query;
    let cache;
    try {
        cache = await browser.list(config.steamApiKey);
    } catch (e) {
        return res.status(400).json({ error: e.message, needsKey: !config.steamApiKey });
    }
    const result = browser.search(cache.servers, {
        q: String(q.q || ''), region: String(q.region || ''), flag: String(q.flag || ''),
        minPlayers: Number(q.minPlayers) || 0, sort: String(q.sort || 'players'),
        offset: Number(q.offset) || 0, limit: Math.min(200, Number(q.limit) || 100)
    });
    res.json({ ...result, servers: result.servers.map(withPaired), cachedAt: cache.at, count: cache.servers.length });
}));

app.get('/api/browse/lookup', guard(async (req, res) => {
    const found = await browser.resolve(String(req.query.addr || ''));
    const out = await Promise.all(found.map(s => browser.details(s.ip, s.queryPort).catch(() => null)));
    res.json(out.filter(Boolean).map(withPaired));
}));

app.get('/api/browse/details', guard(async (req, res) => {
    const d = await browser.details(String(req.query.ip), Number(req.query.port));
    res.json({ ...withPaired(d), pop: watch.data.pop[d.id] || [] });
}));

app.get('/api/watch', (req, res) => res.json(Object.values(watch.data.list).map(w => ({ ...w, paired: pairedFor(w.ip), pop: (watch.data.pop[w.id] || []).slice(-120) }))));

app.post('/api/watch', guard(async (req, res) => {
    const { ip, queryPort } = req.body || {};
    const d = await browser.details(String(ip), Number(queryPort));
    watch.data.list[d.id] = { id: d.id, ip: d.ip, queryPort: d.queryPort, gamePort: d.gamePort, name: d.name, wipe: d.wipe, players: d.players, maxPlayers: d.maxPlayers, queued: d.queued, online: true, checked: Date.now(), added: Date.now() };
    (watch.data.pop[d.id] ??= []).push([Date.now(), d.players, d.queued, d.maxPlayers]);
    watch.touch();
    res.json({ ok: true });
}));

app.delete('/api/watch/:id', (req, res) => {
    delete watch.data.list[req.params.id];
    delete watch.data.pop[req.params.id];
    watch.touch();
    res.json({ ok: true });
});

app.get('/api/rustmaps', guard(async (req, res) => {
    const size = Number(req.query.size), seed = Number(req.query.seed), id = String(req.query.id || '');
    if (!id && (!size || !Number.isFinite(seed))) return res.status(400).json({ error: 'id, or size and seed, required' });
    const dir = path.join(DATA, 'rustmaps');
    try {
        res.json(id ? await rustmaps.lookupById(config.rustMapsKey, id, dir) : await rustmaps.lookup(config.rustMapsKey, size, seed, dir));
    } catch (e) {
        res.json({ ready: false, state: 'error', error: e.message });
    }
}));

const mapSource = url => /^https:\/\/[^\s?#]+\.map(\?[^\s#]*)?$/i.test(url) || terrain.FILE_KEY.test(url);
const MAPFILES = () => path.join(DATA, 'terrain');

app.post('/api/mapfile', express.raw({ type: '*/*', limit: '400mb' }), guard(async (req, res) => {
    const name = decodeURIComponent(String(req.get('x-file-name') || 'map'));
    res.json(await terrain.loadFile(req.body, MAPFILES(), gameTables(), name));
}));
app.get('/api/mapfiles', (req, res) => res.json(terrain.listFiles(MAPFILES()).map(({ monuments, ...m }) => ({ ...m, monumentCount: monuments.length }))));
app.get('/api/mapfile/:id', (req, res) => {
    const m = terrain.listFiles(MAPFILES()).find(x => x.id === req.params.id);
    m ? res.json(m) : res.status(404).json({ error: 'not found' });
});
app.get('/api/mapfile/:id/preview.png', (req, res) => {
    if (!/^[0-9a-f]{40}$/.test(req.params.id)) return res.sendStatus(400);
    const file = path.join(MAPFILES(), `${req.params.id}.preview.png`);
    fs.existsSync(file) ? res.type('png').set('Cache-Control', 'max-age=31536000, immutable').sendFile(file) : res.sendStatus(404);
});
app.delete('/api/mapfile/:id', (req, res) => { terrain.removeFile(MAPFILES(), req.params.id); res.json({ ok: true }); });

app.get('/api/terrain', guard(async (req, res) => {
    const url = String(req.query.url || '');
    if (!mapSource(url)) return res.status(400).json({ error: 'not a map file URL' });
    const { grid } = await terrain.load(url, path.join(DATA, 'terrain'), gameTables());
    res.type('application/octet-stream').send(grid);
}));

app.get('/api/facilities', guard(async (req, res) => {
    const url = String(req.query.url || '');
    if (!mapSource(url)) return res.status(400).json({ error: 'not a map file URL' });
    const { facilities } = await terrain.load(url, path.join(DATA, 'terrain'), gameTables());
    res.json(facilities);
}));

const tracking = new Tracking(path.join(DATA, 'tracked.json'), {
    alert: (kind, text) => alert(kind, text),
    getServer: () => session?.queryAddr || null,
    getKey: () => config.steamApiKey
});

const DISCORD_EXTRA = { status: 'server + connection', timers: 'your decay timers', tracked: 'tracked players', say: 'post to team chat (if allowed)' };
async function discordCommand(cmd, args, msg) {
    const p = config.discordBot.prefix;
    if (cmd === 'help') {
        return `**Commands** (prefix \`${p}\`)\n${chatbot.COMMANDS.filter(c => c !== 'help').map(c => `\`${c}\``).join(' ')}\n`
            + Object.entries(DISCORD_EXTRA).map(([c, d]) => `\`${c}\` ${d}`).join(' · ');
    }
    if (cmd === 'ack') return acknowledge(msg.author.global_name || msg.author.username) ? 'Raid alarm answered, reminders stopped.' : 'No raid alarm is ringing.';
    if (cmd === 'tracked') {
        const snap = await tracking.snapshot();
        const lines = snap.groups.flatMap(g => g.members.map(m =>
            `${m.state === 'here' ? '🟢' : m.state === 'rust' ? '🟡' : m.state === 'online' ? '🔵' : '⚫'} **${m.name}** (${g.name}) — ${m.stateLabel}${m.rustHours ? ` · ${m.rustHours}h Rust` : ''}`));
        return lines.length ? { title: 'Tracked players', description: lines.join('\n'), color: 0x3fa9f5 } : 'Nobody tracked yet — add players in the Tracked tab.';
    }
    if (!session) return 'No Rust server connected right now.';
    if (cmd === 'status') {
        const i = session.state.info;
        return `**${session.server.name}** — ${session.state.status}${i ? ` · ${i.players}/${i.maxPlayers} players${i.queuedPlayers ? ` (+${i.queuedPlayers})` : ''}` : ''}`;
    }
    if (cmd === 'timers') {
        const size = session.state.mapMeta?.mapSize;
        const list = session.pins.list.filter(x => x.kind === 'decay').sort((a, b) => a.end - b.end);
        if (!list.length) return 'No decay timers running.';
        return { title: 'Decay timers', color: 0xe4a73a, description: list.map(x => {
            const left = x.end - Date.now();
            const where = Number.isFinite(x.x) && size ? ` (${geo.gridOf(x.x, x.y, size)})` : '';
            return `**${x.label || x.name}**${where} — ${left > 0 ? `falls <t:${Math.round(x.end / 1000)}:R>` : 'decayed'}`;
        }).join('\n') };
    }
    if (cmd === 'say') {
        if (!config.discordBot.allowSay) return 'Posting to team chat from Discord is switched off in Settings.';
        const text = args.join(' ').trim();
        if (!text) return `Usage: ${p}say <message>`;
        await session.say(`[${msg.author.global_name || msg.author.username}] ${text}`);
        return 'Sent to team chat.';
    }
    return chatbot.handle(`${p}${cmd} ${args.join(' ')}`.trim(), p, session.botContext());
}


function startPhone() {
    if (!config.phone.enabled || !isPro()) return phone.stop();
    if (!/^[0-9a-f]{64}$/.test(config.phone.token)) {
        config.phone.token = require('crypto').randomBytes(32).toString('hex');
        saveConfig();
    }
    if (phone.status !== 'on' || phone.token !== config.phone.token) phone.start(config.port + 1, config.phone.token);
}

const phoneInfo = () => ({ enabled: config.phone.enabled, status: phone.status, port: config.port + 1, links: phone.status === 'on' ? phone.links() : [] });
app.get('/api/phone', (req, res) => res.json(phoneInfo()));
app.put('/api/phone', needPro, (req, res) => {
    config.phone.enabled = !!req.body?.enabled;
    saveConfig();
    startPhone();
    setTimeout(() => res.json(phoneInfo()), 300);
});
app.post('/api/phone/new-link', needPro, (req, res) => {
    config.phone.token = require('crypto').randomBytes(32).toString('hex');
    saveConfig();
    startPhone();
    setTimeout(() => res.json(phoneInfo()), 300);
});
app.get('/api/phone/qr.svg', guard(async (req, res) => {
    const link = phone.status === 'on' ? phone.links()[Number(req.query.i) || 0] : null;
    if (!link) return res.sendStatus(404);
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await require('qrcode').toString(link, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } }));
}));

function startDiscordBot() {
    discordBot?.stop();
    discordBot = null;
    const c = config.discordBot;
    if (!c.enabled || !isPro()) return;
    discordBot = new DiscordBot({ token: c.token, channelId: c.channelId, prefix: c.prefix, onCommand: discordCommand, log });
    discordBot.start();
}
app.get('/api/tracked', guard(async (req, res) => res.json(await tracking.snapshot())));
app.post('/api/tracked/refresh', guard(async (req, res) => { await tracking.poll(); res.json(await tracking.snapshot()); }));
app.post('/api/tracked/groups', guard(async (req, res) => res.json(await tracking.addGroup(req.body?.name))));
app.delete('/api/tracked/groups/:id', (req, res) => { tracking.removeGroup(req.params.id); res.json({ ok: true }); });
app.post('/api/tracked/groups/:id/members', async (req, res) => {
    try {
        res.json(await tracking.addMember(req.params.id, req.body?.input));
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});
app.delete('/api/tracked/groups/:id/members/:key', (req, res) => { tracking.removeMember(req.params.id, req.params.key); res.json({ ok: true }); });

let tablesCache = null;
function gameTables() {
    return tablesCache ??= {
        ores: readJson(path.join(STATIC, 'ores.json'), null),
        spawns: readJson(path.join(STATIC, 'spawns.json'), null),
        facilities: readJson(path.join(STATIC, 'facilities.json'), null),
        monuments: readJson(path.join(STATIC, 'monuments.json'), null)
    };
}

app.get('/api/rmtile', guard(async (req, res) => {
    const url = String(req.query.u || '');
    if (!/^https:\/\/content\.rustmaps\.com\/maps\/\d+\/[0-9a-f]{32}\/[a-z0-9]+\/tiles\/-?\d+\/-?\d+\/-?\d+\.png$/i.test(url)) {
        return res.status(400).json({ error: 'not a RustMaps heat tile' });
    }
    const file = path.join(DATA, 'rustmaps', 'tiles', url.replace(/^https:\/\//, '').replace(/[^\w.-]/g, '_'));
    if (!fs.existsSync(file)) {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return res.sendStatus(r.status);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    res.type('image/webp').sendFile(file);
}));

app.get('/api/settings', (req, res) => res.json({
    discordWebhook: config.discordWebhook ? '(set)' : '',
    steamApiKey: config.steamApiKey ? '(set)' : '',
    rustMapsKey: config.rustMapsKey ? '(set)' : '',
    bot: config.bot, alerts: config.alerts, alertKinds: ALERT_KINDS,
    discordBot: { ...config.discordBot, token: config.discordBot.token ? '(set)' : '' },
    discordBotStatus: discordBot?.status ?? 'off',
    upkeepAlertHours: config.upkeepAlertHours, decayAlertMinutes: config.decayAlertMinutes,
    escalation: config.escalation,
    commands: chatbot.COMMANDS
}));

app.post('/api/escalation/ack', (req, res) => {
    const me = session?.state.team?.members?.find(m => String(m.steamId) === String(session.server.playerId))?.name;
    res.json({ ok: acknowledge(me || 'Someone at the PC') });
});
app.post('/api/escalation/test', needPro, (req, res) => {
    if (!config.escalation.enabled) return res.status(400).json({ error: 'Turn on raid alarm escalation and save first' });
    alert('alarm', 'Test alarm from RustScout (nothing is happening)');
    res.json({ ok: true });
});

app.put('/api/settings', (req, res) => {
    const b = req.body || {};
    if (b.discordBot?.channelId && !/^\d{15,25}$/.test(String(b.discordBot.channelId).trim())) {
        return res.status(400).json({ error: 'Channel ID should be a long number (right-click the channel → Copy Channel ID)' });
    }
    if (typeof b.discordWebhook === 'string' && b.discordWebhook !== '(set)') {
        if (b.discordWebhook && !/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(b.discordWebhook)) {
            return res.status(400).json({ error: 'That is not a Discord webhook URL' });
        }
        config.discordWebhook = b.discordWebhook;
    }
    if (typeof b.steamApiKey === 'string' && b.steamApiKey !== '(set)') config.steamApiKey = b.steamApiKey.trim();
    if (typeof b.rustMapsKey === 'string' && b.rustMapsKey !== '(set)') config.rustMapsKey = b.rustMapsKey.trim();
    if (b.bot) config.bot = { enabled: !!b.bot.enabled, prefix: String(b.bot.prefix || '!').slice(0, 3) };
    if (b.discordBot) {
        const d = b.discordBot, cur = config.discordBot;
        const before = JSON.stringify(cur);
        config.discordBot = {
            enabled: !!d.enabled,
            token: typeof d.token === 'string' && d.token !== '(set)' ? d.token.trim() : cur.token,
            channelId: String(d.channelId ?? cur.channelId).trim(),
            prefix: String(d.prefix || '!').slice(0, 3),
            allowSay: !!d.allowSay
        };
        if (JSON.stringify(config.discordBot) !== before || (config.discordBot.enabled && !discordBot)) startDiscordBot();
    }
    if (b.alerts) for (const k of Object.keys(ALERT_KINDS)) if (b.alerts[k]) config.alerts[k] = { toast: !!b.alerts[k].toast, discord: !!b.alerts[k].discord };
    const num = v => v !== '' && v !== null && v !== undefined && Number.isFinite(+v) && +v >= 0 ? +v : null;
    if (num(b.upkeepAlertHours) !== null) config.upkeepAlertHours = num(b.upkeepAlertHours);
    if (num(b.decayAlertMinutes) > 0) config.decayAlertMinutes = num(b.decayAlertMinutes);
    if (b.escalation) {
        const e = b.escalation, mention = String(e.mention ?? '').trim();
        if (mention && !mentionFor(mention)) return res.status(400).json({ error: 'Mention must be @here, @everyone, a role like <@&123…> or a user like <@123…>' });
        config.escalation = {
            enabled: !!e.enabled, sound: !!e.sound, mention,
            repeatMinutes: Math.min(30, Math.max(1, num(e.repeatMinutes) ?? 2)),
            maxRepeats: Math.min(20, Math.max(1, Math.round(num(e.maxRepeats) ?? 5)))
        };
        if (!config.escalation.enabled) acknowledge('Settings');
    }
    saveConfig();
    res.json({ ok: true });
});

const LICENSE_KEY = require('crypto').createPublicKey({ key: Buffer.from('MCowBQYDK2VwAyEAJEjFkGTZEtEibQw8r7mmxkMlZ9vxLc9B6Rch0NqyG6U=', 'base64'), format: 'der', type: 'spki' });
const LICENSE_SERVER = process.env.RUSTSCOUT_LICENSE_SERVER || 'https://rustscout-pro.infxrnoz.workers.dev';
const { machineId, keyId } = require('./src/machine');
function readSigned(token, prefix) {
    const m = new RegExp(`^${prefix}-([\\w-]+)\\.([\\w-]+)$`).exec(String(token || '').trim());
    if (!m) return null;
    try {
        if (!require('crypto').verify(null, Buffer.from(m[1]), LICENSE_KEY, Buffer.from(m[2], 'base64url'))) return null;
        return JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    } catch { return null; }
}
const readLicense = key => {
    const l = readSigned(key, 'RS1');
    return l && typeof l.e === 'string' && typeof l.s === 'string' && l.m === undefined ? l : null;
};
const license = () => readLicense(config.licenseKey);
const activated = () => {
    const a = readSigned(config.licenseActivation, 'RA1');
    return !!a && a.m === machineId && a.k === keyId(config.licenseKey);
};
const isPro = () => !!license() && activated();

async function licenseServer(action, key) {
    let r;
    try {
        r = await fetch(`${LICENSE_SERVER}/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, machine: machineId }), signal: AbortSignal.timeout(15000)
        });
    } catch { return { status: 503, error: 'Couldn’t reach the licence server. Check your internet and try again.' }; }
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { status: r.status, error: j.error || `Licence server answered ${r.status}` };
}

async function recheckLicense() {
    if (!license() || !activated()) return;
    const r = await licenseServer('activate', config.licenseKey);
    if (r.status === 403 || r.status === 409) {
        config.licenseActivation = '';
        saveConfig();
        startDiscordBot();
        startPhone();
        log(`RustScout Pro turned off: ${r.error}`);
        return;
    }
    const a = !r.error && readSigned(r.activation, 'RA1');
    if (a && a.m === machineId && a.k === keyId(config.licenseKey)) { config.licenseActivation = r.activation; saveConfig(); }
}
recheckLicense();
setInterval(recheckLicense, 12 * 3600e3).unref();

startDiscordBot();
startPhone();
app.get('/api/license', (req, res) => res.json({ pro: isPro(), email: license()?.e ?? null, seats: license()?.n || 1, needsActivation: !!license() && !activated() }));
app.post('/api/license', guard(async (req, res) => {
    const key = String(req.body?.key || config.licenseKey || '').trim();
    if (!readLicense(key)) return res.status(400).json({ error: 'That key isn’t valid. Copy the whole key, starting with RS1-' });
    const r = await licenseServer('activate', key);
    if (r.error) return res.status(r.status).json({ error: r.error });
    const a = readSigned(r.activation, 'RA1');
    if (!a || a.m !== machineId || a.k !== keyId(key)) return res.status(502).json({ error: 'The licence server sent back something unexpected. Try again.' });
    config.licenseKey = key;
    config.licenseActivation = r.activation;
    saveConfig();
    startDiscordBot();
    startPhone();
    res.json({ pro: true, email: readLicense(key).e ?? null });
}));
app.delete('/api/license', guard(async (req, res) => {
    if (config.licenseKey && activated()) {
        const r = await licenseServer('deactivate', config.licenseKey);
        if (r.error && r.status !== 409) return res.status(r.status).json({ error: r.error });
    }
    config.licenseKey = '';
    config.licenseActivation = '';
    saveConfig();
    startDiscordBot();
    startPhone();
    res.json({ pro: false });
}));

const APPEARANCE_FILE = path.join(DATA, 'appearance.json');
const BG_DIR = path.join(DATA, 'appearance');
const BG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const bgFile = () => fs.existsSync(BG_DIR) ? fs.readdirSync(BG_DIR).find(f => f.startsWith('background.')) : null;
app.get('/api/appearance', (req, res) => res.json(readJson(APPEARANCE_FILE, {})));
app.put('/api/appearance', (req, res) => {
    if (!isPro()) return res.status(402).json({ error: 'Appearance is a RustScout Pro feature' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Bad appearance' });
    writeJson(APPEARANCE_FILE, req.body);
    res.json({ ok: true });
});
app.post('/api/appearance/background', express.raw({ type: Object.keys(BG_TYPES), limit: '80mb' }), (req, res) => {
    if (!isPro()) return res.status(402).json({ error: 'Appearance is a RustScout Pro feature' });
    const ext = BG_TYPES[String(req.get('content-type')).split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Pick a PNG, JPG, GIF, WebP, MP4 or WebM file (80 MB max)' });
    fs.mkdirSync(BG_DIR, { recursive: true });
    const old = bgFile();
    if (old) fs.rmSync(path.join(BG_DIR, old), { force: true });
    fs.writeFileSync(path.join(BG_DIR, `background.${ext}`), req.body);
    res.json({ ok: true, kind: ['mp4', 'webm'].includes(ext) ? 'video' : 'image' });
});
app.get('/api/appearance/background', (req, res) => { const f = bgFile(); f ? res.sendFile(path.join(BG_DIR, f)) : res.sendStatus(404); });
app.delete('/api/appearance/background', (req, res) => { const f = bgFile(); if (f) fs.rmSync(path.join(BG_DIR, f), { force: true }); res.json({ ok: true }); });

app.post('/api/settings/test-webhook', guard(async (req, res) => {
    if (!config.discordWebhook) return res.status(400).json({ error: 'No webhook set' });
    const r = await fetch(config.discordWebhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'RustScout', content: 'Webhook connected. Alerts will land here.' })
    });
    r.ok ? res.json({ ok: true }) : res.status(400).json({ error: `Discord answered ${r.status}` });
}));

wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'servers', servers: publicServers() }));
    ws.send(JSON.stringify({ type: 'reset', snapshot: session?.snapshot() ?? null }));
    if (escalation.active) ws.send(JSON.stringify({ type: 'escalation', escalation: escalation.active }));
});

httpServer.on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e;
    log(`Port ${config.port} is busy — RustScout is probably already running (maybe in the background). Open http://localhost:${config.port}`);
    process.exit(1);
});
let markListening;
const listening = new Promise(resolve => { markListening = resolve; });
httpServer.listen(config.port, '127.0.0.1', () => {
    log(`RustScout running at http://localhost:${config.port}`);
    if (!process.env.DESKTOP) fs.writeFileSync(PID_FILE, String(process.pid));
    markListening(config.port);
    startFcm();
    pollWatched();
    if (store.active && store.list[store.active]) activate(store.active);
});

process.on('unhandledRejection', e => log('unhandled error:', e?.message || e));

const PID_FILE = path.join(DATA, 'app.pid');
process.on('exit', () => { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {  } });

const stop = () => {
    discordBot?.stop();
    phone.stop();
    fcm.client?.destroy();
    session?.close();
    threats.flush();
    watch.flush();
    tracking.close();
};
const shutdown = () => {
    stop();
    process.exit(0);
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);

module.exports = { listening, startFcm, stop, isPro, credsFile: CREDS_FILE, fcmStatus: () => fcm.status };
