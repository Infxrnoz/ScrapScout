const WebSocket = require('ws');

const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const GATEWAY = process.env.DISCORD_GATEWAY || 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const FATAL = {
    4004: 'Bot token was rejected — copy it again from the Developer Portal (Bot → Reset Token)',
    4013: 'Invalid intents',
    4014: 'Turn on "Message Content Intent" in the Developer Portal (Bot page), then save settings again'
};

class DiscordBot {
    constructor(opts) {
        this.opts = opts;
        this.status = 'off';
        this.ws = null;
        this.seq = null;
        this.beat = null;
        this.retry = null;
        this.stopped = false;
        this.user = null;
    }

    start() {
        if (!this.opts.token || !this.opts.channelId) { this.status = 'needs a bot token and a channel ID'; return; }
        this.stopped = false;
        this.status = 'connecting';
        this.connect();
    }

    stop() {
        this.stopped = true;
        clearInterval(this.beat);
        clearTimeout(this.retry);
        try { this.ws?.close(1000); } catch {  }
        this.ws = null;
        this.status = 'off';
    }

    connect() {
        const ws = this.ws = new WebSocket(GATEWAY);
        ws.on('message', raw => {
            let p;
            try { p = JSON.parse(raw); } catch { return; }
            if (p.s) this.seq = p.s;
            this.onPayload(p).catch(e => this.opts.log(`discord bot: ${e.message}`));
        });
        ws.on('close', code => {
            clearInterval(this.beat);
            if (this.stopped || ws !== this.ws) return;
            if (FATAL[code]) { this.status = FATAL[code]; this.opts.log(`discord bot stopped: ${this.status}`); return; }
            this.status = 'reconnecting';
            this.retry = setTimeout(() => this.connect(), 5000);
        });
        ws.on('error', e => this.opts.log(`discord gateway error: ${e.message || e.code || 'connection lost'}`));
    }

    send(op, d) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
    }

    async onPayload({ op, t, d }) {
        if (op === 10) {
            clearInterval(this.beat);
            this.beat = setInterval(() => this.send(1, this.seq), Math.min(60000, Math.max(5000, Number(d.heartbeat_interval) || 41250)));
            this.send(2, { token: this.opts.token, intents: INTENTS, properties: { os: process.platform, browser: 'rustscout', device: 'rustscout' } });
        } else if (op === 1) {
            this.send(1, this.seq);
        } else if (op === 7 || op === 9) {
            this.ws.close(4000);
        } else if (op === 0 && t === 'READY') {
            this.user = d.user;
            this.status = `online as ${d.user.username}`;
            this.opts.log(`discord bot ${this.status}`);
        } else if (op === 0 && t === 'MESSAGE_CREATE') {
            await this.onMessage(d);
        }
    }

    async onMessage(m) {
        const { prefix, channelId } = this.opts;
        if (m.author?.bot || m.channel_id !== channelId || !m.content?.startsWith(prefix)) return;
        const [cmd, ...args] = m.content.slice(prefix.length).trim().split(/\s+/);
        if (!cmd) return;
        const reply = await this.opts.onCommand(cmd.toLowerCase(), args.filter(Boolean), m);
        if (reply) await this.post(reply, m.id);
    }

    async post(body, replyTo) {
        const payload = typeof body === 'string'
            ? { content: body.slice(0, 1900) }
            : { embeds: [{ ...body, description: body.description?.slice(0, 4000) }] };
        payload.allowed_mentions = { parse: [] };
        if (replyTo) payload.message_reference = { message_id: replyTo, fail_if_not_exists: false };
        const r = await fetch(`${API}/channels/${this.opts.channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${this.opts.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) {
            const why = r.status === 403 ? 'the bot cannot post in that channel (check its permissions)' : r.status === 404 ? 'channel not found (check the channel ID)' : `HTTP ${r.status}`;
            throw new Error(`send failed: ${why}`);
        }
    }
}

module.exports = { DiscordBot };
