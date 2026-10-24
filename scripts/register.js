const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const ChromeLauncher = require('chrome-launcher');
const { register, LOGIN_URL } = require('../src/register');

const PORT = 3100;
const OUT = path.join(__dirname, '..', 'rustplus.config.json');

const PAIR_PAGE = `<!doctype html><meta charset="utf-8"><title>ScrapScout — link Steam</title>
<body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:460px;text-align:center"><h2>Link your Steam account</h2>
<p>A Rust+ login window should have opened. Sign in with Steam there.</p>
<p style="color:#999">No window? Allow pop-ups for this page and refresh.</p></div>
<script>
const popup = window.open('${LOGIN_URL}', 'rustplus', 'width=520,height=760');
const timer = setInterval(() => {
    try {
        if (popup && popup.ReactNativeWebView === undefined) {
            popup.ReactNativeWebView = { postMessage(message) {
                clearInterval(timer);
                const auth = JSON.parse(message);
                location.href = '/callback?token=' + encodeURIComponent(auth.Token);
                popup.close();
            } };
        }
    } catch (e) { /* popup is between pages */ }
}, 250);
</script>`;

function findEdge() {
    const candidates = [
        path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')
    ];
    return candidates.find(p => p && fs.existsSync(p));
}

async function getSteamToken() {
    const app = express();
    let browser;
    const token = new Promise((resolve, reject) => {
        app.get('/', (req, res) => res.send(PAIR_PAGE));
        app.get('/callback', (req, res) => {
            if (!req.query.token) {
                res.status(400).send('No token received — close this window and run the setup again.');
                return reject(new Error('Rust+ login returned no token'));
            }
            res.send('<body style="font:16px system-ui;background:#111;color:#eee;padding:40px">Linked! You can close this window.</body>');
            resolve(String(req.query.token));
        });
    });
    const server = app.listen(PORT, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });

    const profile = path.join(os.tmpdir(), `scrapscout-steam-link-${Date.now()}`);
    const flags = ['--disable-web-security', '--disable-site-isolation-trials', '--disable-popup-blocking', '--no-first-run', `--user-data-dir=${profile}`];
    try {
        browser = await ChromeLauncher.launch({ startingUrl: `http://localhost:${PORT}`, chromeFlags: flags, userDataDir: profile, handleSIGINT: false });
    } catch {
        const edge = findEdge();
        if (!edge) throw new Error('Google Chrome or Microsoft Edge is needed for the Steam login. Install Chrome and run this again.');
        console.log('Chrome not found — using Microsoft Edge.');
        browser = await ChromeLauncher.launch({ chromePath: edge, startingUrl: `http://localhost:${PORT}`, chromeFlags: flags, userDataDir: profile, handleSIGINT: false });
    }

    try {
        return await token;
    } finally {
        server.close();
        try { await browser.kill(); } catch {  }
        fs.rm(profile, { recursive: true, force: true }, () => {});
    }
}

(async () => {
    const config = await register(getSteamToken, (step, text) => console.log(`${step}/4  ${step === 3 ? 'A browser window is opening — sign in with Steam to link it to Rust+.' : text}`));
    fs.writeFileSync(OUT, JSON.stringify(config, null, 2));
    console.log(`
Done! Saved ${path.basename(OUT)}. Now run:  npm start`);
    console.log('Then in Rust: ESC → Rust+ → Pair with server.');
    process.exit(0);
})().catch(e => {
    console.error(`
Setup failed: ${e.message}`);
    process.exit(1);
});
