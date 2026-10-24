const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };

function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family !== 'IPv4' || a.internal) continue;
            if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
        }
    }
    return out;
}

const sameToken = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const cookieToken = req => /(?:^|;\s*)rs=([0-9a-f]{64})/.exec(req.headers.cookie || '')?.[1];

class PhoneServer {
    constructor({ root, leafletDir, mapFile, pop, snapshot, log, host = '0.0.0.0' }) {
        this.opts = { root, leafletDir, mapFile, pop, snapshot, log, host };
        this.server = null;
        this.wss = null;
        this.status = 'off';
    }

    authed(req, url) {
        return sameToken(cookieToken(req), this.token) || sameToken(url.searchParams.get('k'), this.token);
    }

    handle(req, res) {
        const url = new URL(req.url, 'http://phone');
        const send = (code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
            res.writeHead(code, { ...HEADERS, 'Content-Type': type, ...extra });
            res.end(body);
        };
        if (req.method !== 'GET') return send(405, 'Not allowed');
        if (!this.authed(req, url)) return send(401, 'Open the link from ScrapScout (Settings → Phone view) to see this page.');
        if (url.searchParams.has('k')) {
            return send(302, '', 'text/plain', { Location: url.pathname, 'Set-Cookie': `rs=${this.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
        }
        const file = p => fs.readFile(p, (e, data) => e ? send(404, 'Not found') : send(200, data, TYPES[path.extname(p)] || 'application/octet-stream'));
        if (url.pathname === '/' || url.pathname === '/phone.html') return file(path.join(this.opts.root, 'phone.html'));
        const leaflet = /^\/vendor\/leaflet\/((images\/)?[\w.-]+\.(js|css|png))$/.exec(url.pathname);
        if (leaflet) return file(path.join(this.opts.leafletDir, leaflet[1]));
        if (url.pathname === '/api/map.jpg') {
            const f = this.opts.mapFile();
            return f ? file(f) : send(404, 'No map yet');
        }
        if (url.pathname === '/api/pop') return send(200, JSON.stringify(this.opts.pop()), 'application/json');
        send(404, 'Not found');
    }

    start(port, token) {
        this.stop();
        this.token = token;
        this.port = port;
        this.server = http.createServer((req, res) => {
            try { this.handle(req, res); } catch (e) { res.writeHead(500); res.end(); }
        });
        this.wss = new WebSocketServer({
            server: this.server, path: '/ws',
            verifyClient: ({ req }) => this.authed(req, new URL(req.url, 'http://phone'))
        });
        this.wss.on('connection', ws => ws.send(JSON.stringify({ type: 'reset', snapshot: this.opts.snapshot() })));
        this.wss.on('error', () => {});
        this.server.on('error', e => {
            this.status = e.code === 'EADDRINUSE' ? `port ${port} is busy` : `error: ${e.message}`;
            this.opts.log(`phone view: ${this.status}`);
            this.stop(false);
        });
        this.server.listen(port, this.opts.host, () => {
            this.status = 'on';
            this.opts.log(`phone view listening on port ${port}`);
        });
    }

    send(text) {
        if (!this.wss) return;
        for (const ws of this.wss.clients) if (ws.readyState === 1) ws.send(text);
    }

    stop(reset = true) {
        for (const ws of this.wss?.clients || []) ws.terminate();
        this.wss?.close();
        this.server?.close();
        this.server = null;
        this.wss = null;
        if (reset) this.status = 'off';
    }

    links() {
        return lanAddresses().map(ip => `http://${ip}:${this.port}/?k=${this.token}`);
    }
}

module.exports = { PhoneServer, lanAddresses };
