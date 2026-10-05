const { app, BrowserWindow, Tray, Menu, shell, dialog, ipcMain, nativeImage, Notification, globalShortcut, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

if (process.env.ROT_USER_DATA) app.setPath('userData', path.resolve(process.env.ROT_USER_DATA));

if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

const ROOT = path.join(__dirname, '..');
const IMPORT_OLD = require(path.join(ROOT, 'package.json')).rustscout?.importOldVersion === true;
const USER = app.getPath('userData');
const DATA = path.join(USER, 'data');
const ICON = path.join(__dirname, 'icon.png');
const hiddenStart = process.argv.includes('--hidden');

let server = null;
let win = null;
let tray = null;
let base = null;
let quitting = false;
let linking = null;

app.setAppUserModelId('com.rustscout.app');

function freePort(from, to) {
    return new Promise((resolve, reject) => {
        const tryPort = p => {
            if (p > to) return reject(new Error(`No free port between ${from} and ${to}`));
            const s = net.createServer();
            s.once('error', () => tryPort(p + 1));
            s.once('listening', () => s.close(() => resolve(p)));
            s.listen(p, '127.0.0.1');
        };
        tryPort(from);
    });
}

async function startServer() {
    fs.mkdirSync(DATA, { recursive: true });
    Object.assign(process.env, {
        DESKTOP: '1',
        DATA_DIR: DATA,
        CONFIG_FILE: path.join(USER, 'config.json'),
        RUSTPLUS_CONFIG: path.join(USER, 'rustplus.config.json'),
        PORT: String(await freePort(30120, 30139))
    });
    for (const k of ['log', 'error']) {
        const orig = console[k];
        console[k] = (...a) => { orig(...a); dlog(a.map(x => x instanceof Error ? x.message : String(x)).join(' ')); };
    }
    server = require(path.join(ROOT, 'server.js'));
    const port = await server.listening;
    base = `http://localhost:${port}`;
}

function showWindow() {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function createWindow() {
    win = new BrowserWindow({
        width: 1440, height: 900, minWidth: 900, minHeight: 600,
        title: 'RustScout', icon: ICON, backgroundColor: '#0b0b0c', autoHideMenuBar: true, show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
    });
    win.loadURL(base);
    win.once('ready-to-show', () => { if (!hiddenStart) win.show(); });

    const external = url => /^(https?|steam):/i.test(url) && !url.startsWith(base);
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (external(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith(base)) return;
        e.preventDefault();
        if (external(url)) shell.openExternal(url);
    });

    win.on('close', e => {
        if (quitting) return;
        e.preventDefault();
        if (appOverlay) return toggleAppOverlay('close button');
        win.hide();
        if (!settings().trayHintShown) {
            saveSettings({ trayHintShown: true });
            new Notification({ title: 'RustScout is still running', body: 'Alerts keep coming. Open it again from the tray icon, or right-click the icon → Quit.', icon: ICON }).show();
        }
    });
    win.on('closed', () => { win = null; });
}

const isPro = () => !!server?.isPro?.();
function askPro() {
    buildTray();
    showWindow();
    win?.webContents.executeJavaScript("openTab('settings'); document.getElementById('pro-box')?.scrollIntoView()").catch(() => {});
    new Notification({ title: 'RustScout Pro', body: 'That’s a Pro feature. Settings → RustScout Pro to unlock it.', icon: ICON }).show();
}
const proOnly = fn => (...a) => isPro() ? fn(...a) : askPro();

const SHELL_FILE = path.join(USER, 'desktop.json');
const settings = () => { try { return JSON.parse(fs.readFileSync(SHELL_FILE, 'utf8')); } catch { return {}; } };
const saveSettings = patch => fs.writeFileSync(SHELL_FILE, JSON.stringify({ ...settings(), ...patch }, null, 2));

const autoStart = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
function setAutoStart(on) {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
    buildTray();
}

function steamLogin(url) {
    return new Promise((resolve, reject) => {
        const w = new BrowserWindow({
            parent: win || undefined, width: 520, height: 780, title: 'Link Steam — Rust+', icon: ICON, autoHideMenuBar: true,
            backgroundColor: '#111111',
            webPreferences: { preload: path.join(__dirname, 'login-preload.js'), contextIsolation: true, sandbox: true, partition: 'rustplus-login' }
        });
        let done = false;
        const allowed = new URL(url).origin;
        const onToken = (e, message) => {
            if (e.sender !== w.webContents || new URL(e.senderFrame?.url || 'about:blank').origin !== allowed) return;
            done = true;
            let token = null;
            try { token = JSON.parse(message).Token; } catch {  }
            token ? resolve(String(token)) : reject(new Error('The Rust+ login didn’t return a token. Try again.'));
            w.close();
        };
        ipcMain.on('rustplus-token', onToken);
        w.on('closed', () => {
            ipcMain.removeListener('rustplus-token', onToken);
            if (!done) reject(new Error('The Steam login window was closed before it finished.'));
        });
        w.loadURL(url);
    });
}

function linkSteam() {
    if (linking) return linking;
    linking = (async () => {
        const { register, LOGIN_URL } = require(path.join(ROOT, 'src', 'register.js'));
        const progress = (step, text) => win?.webContents.send('link-progress', { step, text });
        const creds = await register(() => steamLogin(process.env.RUSTPLUS_LOGIN_URL || LOGIN_URL), progress);
        fs.writeFileSync(server.credsFile, JSON.stringify(creds, null, 2));
        await server.startFcm();
        return { ok: true, status: server.fcmStatus() };
    })().catch(e => ({ ok: false, error: e.message })).finally(() => { linking = null; });
    return linking;
}

ipcMain.handle('link-steam', () => linkSteam());
ipcMain.on('show-window', () => showWindow());

const IMPORT = {
    user: ['config.json', 'rustplus.config.json'],
    data: ['servers.json', 'servers', 'tracked.json', 'threats.json', 'watch.json', 'fcm-seen.json', 'terrain', 'rustmaps']
};

const importable = dir => [...IMPORT.user.map(f => path.join(dir, f)), ...IMPORT.data.map(f => path.join(dir, 'data', f))].filter(f => fs.existsSync(f));

function importFrom(dir) {
    const copied = [];
    for (const f of IMPORT.user) if (fs.existsSync(path.join(dir, f))) { fs.cpSync(path.join(dir, f), path.join(USER, f)); copied.push(f); }
    for (const f of IMPORT.data) if (fs.existsSync(path.join(dir, 'data', f))) { fs.cpSync(path.join(dir, 'data', f), path.join(DATA, f), { recursive: true }); copied.push(`data/${f}`); }
    try {
        const c = JSON.parse(fs.readFileSync(path.join(USER, 'config.json'), 'utf8'));
        delete c.port;
        delete c.credentialsFile;
        fs.writeFileSync(path.join(USER, 'config.json'), JSON.stringify(c, null, 2));
    } catch {  }
    return copied;
}

async function importOld() {
    const pick = await dialog.showOpenDialog(win, { title: 'Pick your old version’s folder (the one with server.js, e.g. rustontop-free)', properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return;
    const dir = pick.filePaths[0];
    if (!importable(dir).some(f => /servers\.json$|config\.json$/.test(f))) {
        dialog.showMessageBox(win, { type: 'warning', title: 'Nothing to import', message: 'That folder doesn’t look like an older RustScout (Rust On Top) folder.', detail: 'Pick the folder that has server.js and a data folder in it.' });
        return;
    }
    const ok = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Import and restart', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Import',
        message: 'Import your servers, settings, Steam link and history?',
        detail: `From ${dir}\n\nThis replaces what the app has now. The old folder isn’t changed.`
    });
    if (ok.response !== 0) return;
    importAndRestart(dir);
}

function importAndRestart(dir) {
    server.stop();
    importFrom(dir);
    quitting = true;
    app.relaunch();
    app.exit(0);
}

const GAMMA_EXE = app.isPackaged ? path.join(process.resourcesPath, 'gamma.exe') : path.join(__dirname, 'gamma', 'gamma.exe');
const KEY_CHOICES = {
    color: ['Control+Alt+V', 'Control+Alt+J', 'Control+Alt+Shift+V'],
    hud: ['Control+Alt+O', 'Control+Alt+U', 'Control+Alt+Shift+O'],
    crosshair: ['Control+Alt+X', 'Control+Alt+C', 'Control+Alt+Shift+X'],
    app: ['Control+Alt+M', 'Control+Alt+R', 'Control+Alt+K', 'Control+Alt+Shift+M']
};
if (process.env.ROT_USER_DATA) for (const k of Object.keys(KEY_CHOICES)) KEY_CHOICES[k] = KEY_CHOICES[k].map(c => c.replace('Alt+', 'Alt+Shift+').replace('Shift+Shift+', 'Shift+'));
const KEYS = {}; 
function claimKey(name, fn) {
    KEYS[name] = KEY_CHOICES[name].find(k => { try { return globalShortcut.register(k, fn); } catch { return false; } }) || null;
}
const keyLabel = name => KEYS[name] ? KEYS[name].replace(/Control/, 'Ctrl').replace(/\+/g, ' + ') : 'no free key';
let gammaProc = null;
let gammaQueue = [];

function gammaHelper() {
    if (gammaProc && gammaProc.exitCode === null) return gammaProc;
    gammaProc = spawn(GAMMA_EXE, ['--serve'], { windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    gammaProc.stdout.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            const done = gammaQueue.shift();
            let r = null;
            try { r = JSON.parse(line); } catch {  }
            done?.(r);
        }
    });
    gammaProc.on('exit', () => { gammaQueue.splice(0).forEach(done => done(null)); gammaProc = null; });
    gammaProc.on('error', () => { gammaQueue.splice(0).forEach(done => done(null)); gammaProc = null; });
    return gammaProc;
}
const gammaLine = line => new Promise(resolve => {
    const proc = gammaHelper();
    gammaQueue.push(resolve);
    proc.stdin.write(`${line}\n`);
});

const COLOR_PRESETS = {
    Default: { vib: -1, sat: 100, bri: 50, con: 50, gam: 1, temp: 0 },
    Balanced: { vib: 70, sat: 110, bri: 50, con: 52, gam: 1.1, temp: 0 },
    Night: { vib: 65, sat: 100, bri: 54, con: 50, gam: 1.6, temp: -10 },
    Snow: { vib: 60, sat: 105, bri: 46, con: 56, gam: 0.95, temp: 10 },
    Desert: { vib: 75, sat: 115, bri: 48, con: 55, gam: 1, temp: -15 }
};
const PROFILE_KEYS = Object.keys(COLOR_PRESETS.Default);
const cleanProfile = p => ({
    name: String(p?.name || 'Profile').trim().slice(0, 24) || 'Profile',
    ...Object.fromEntries(PROFILE_KEYS.map(k => [k, Number.isFinite(+p?.[k]) ? +p[k] : COLOR_PRESETS.Default[k]]))
});
function colorSettings() {
    const c = settings().color || {};
    const profiles = Array.isArray(c.profiles) && c.profiles.length ? c.profiles.map(cleanProfile)
        : 'vib' in c ? [cleanProfile({ ...c, name: 'My profile' })]
        : ['Balanced', 'Night', 'Snow', 'Desert'].map(name => cleanProfile({ name, ...COLOR_PRESETS[name] }));
    return { on: !!c.on, active: Math.min(Math.max(0, c.active | 0), profiles.length - 1), profiles };
}
let colorResult = null;
const colorState = () => ({ ...colorSettings(), presets: COLOR_PRESETS, result: colorResult });
async function applyColor() {
    const c = colorSettings(), p = c.profiles[c.active];
    const base = settings().vibBase ?? -1;
    colorResult = await gammaLine(c.on ? `color ${p.vib} ${p.sat} ${p.bri} ${p.con} ${p.gam} ${p.temp} ${base}` : `color -1 100 50 50 1 0 ${base}`);
    if (c.on && !colorResult?.ok) dlog(`colour profile failed: ${JSON.stringify(colorResult)}`);
    buildTray();
    win?.webContents.send('color-settings', colorState());
    return colorState();
}
async function setColor(patch) {
    if (!isPro()) { askPro(); return colorState(); }
    const c = colorSettings();
    const profiles = (Array.isArray(patch.profiles) ? patch.profiles.map(cleanProfile) : c.profiles).slice(0, 20);
    if (!profiles.length) profiles.push(cleanProfile({ name: 'Default', ...COLOR_PRESETS.Default }));
    const active = Math.min(Math.max(0, (patch.active ?? c.active) | 0), profiles.length - 1);
    if (patch.profile) profiles[active] = cleanProfile({ ...profiles[active], ...patch.profile });
    saveSettings({ color: { on: patch.on ?? c.on, active, profiles } });
    return applyColor();
}
async function cycleColor() {
    if (!isPro()) return askPro();
    const c = colorSettings();
    const s = await setColor(!c.on ? { on: true, active: 0 } : c.active + 1 < c.profiles.length ? { active: c.active + 1 } : { on: false });
    new Notification({ title: 'Colour profile', body: s.on ? s.profiles[s.active].name : 'Off', silent: true, icon: ICON }).show();
}
ipcMain.handle('color-get', async () => {
    if (!colorResult) colorResult = await gammaLine(`color -1 100 50 50 1 0 ${settings().vibBase ?? -1}`);
    return colorState();
});
ipcMain.handle('color-set', (e, patch) => setColor(patch || {}));

function resetGamma() {
    if (!gammaProc) return;
    try { gammaProc.stdin.write('quit\n'); gammaProc.stdin.end(); } catch {  }
}

function registerColorKeys() {
    claimKey('color', cycleColor);
}

const OVERLAY_DEFAULT = { hud: false, hudCorner: 'top-right', display: null, crosshair: { on: false, style: 'cross', size: 8, gap: 4, thickness: 2, color: '#00ff66', opacity: 1, outline: true, dot: false } };
let overlayWin = null;

const overlaySettings = () => {
    const o = settings().overlay || {};
    return { ...OVERLAY_DEFAULT, ...o, crosshair: { ...OVERLAY_DEFAULT.crosshair, ...o.crosshair } };
};

function updateOverlay() {
    const o = overlaySettings();
    const want = isPro() && (o.hud || o.crosshair.on);
    if (!want) { overlayWin?.destroy(); overlayWin = null; buildTray(); return; }
    const display = screen.getAllDisplays().find(d => d.id === o.display) || screen.getPrimaryDisplay();
    if (!overlayWin) {
        overlayWin = new BrowserWindow({
            ...display.bounds, transparent: true, frame: false, resizable: false, movable: false, focusable: false,
            skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
            webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
        });
        overlayWin.setAlwaysOnTop(true, 'screen-saver'); 
        overlayWin.setIgnoreMouseEvents(true);            
        overlayWin.loadURL(`${base}/overlay.html`);
        overlayWin.webContents.on('did-finish-load', () => { overlayWin?.showInactive(); sendOverlay(); });
        overlayWin.on('resize', () => sendOverlay());
        overlayWin.on('closed', () => { overlayWin = null; });
    } else {
        overlayWin.setBounds(display.bounds);
    }
    sendOverlay();
    buildTray();
}

function sendOverlay() {
    if (!overlayWin) return;
    const o = overlaySettings();
    const d = (screen.getAllDisplays().find(x => x.id === o.display) || screen.getPrimaryDisplay()).bounds;
    const w = overlayWin.getBounds();
    overlayWin.webContents.send('overlay-settings', { ...o, center: { x: d.x + d.width / 2 - w.x, y: d.y + d.height / 2 - w.y } });
}

function setOverlay(patch) {
    if (!isPro()) { askPro(); return overlaySettings(); }
    const o = overlaySettings();
    const next = { ...o, ...patch, crosshair: { ...o.crosshair, ...patch.crosshair } };
    saveSettings({ overlay: next });
    updateOverlay();
    win?.webContents.send('overlay-settings', next);
    return next;
}

ipcMain.handle('overlay-get', () => overlaySettings());
ipcMain.handle('hotkeys', () => Object.fromEntries(Object.keys(KEY_CHOICES).map(k => [k, keyLabel(k)])));
ipcMain.handle('overlay-set', (e, patch) => setOverlay(patch || {}));
ipcMain.handle('overlay-displays', () => screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: `Screen ${i + 1} — ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' (main)' : ''}`
})));

let appOverlay = null; 

function dlog(msg) {
    try {
        const f = path.join(USER, 'desktop.log');
        if (fs.existsSync(f) && fs.statSync(f).size > 200000) fs.renameSync(f, f + '.old');
        fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
    } catch {  }
}
const winState = () => win ? `visible=${win.isVisible()} onTop=${win.isAlwaysOnTop()} minimized=${win.isMinimized()} focused=${win.isFocused()}` : 'no window';

function toggleAppOverlay(source = 'hotkey') {
    if (!win) createWindow();
    if (appOverlay && !(win.isVisible() && !win.isMinimized() && win.isAlwaysOnTop())) {
        dlog(`app overlay: state said open but window is not (${winState()}), opening instead`);
        appOverlay = null;
    }
    try {
        appOverlayStep();
    } catch (e) {
        dlog(`app overlay error: ${e.stack || e.message}`);
        appOverlay = null;
    }
    dlog(`app overlay ${source}: now ${appOverlay ? 'OPEN' : 'CLOSED'} (${winState()})`);
}

function appOverlayStep() {
    if (appOverlay) {
        const saved = appOverlay;
        appOverlay = null;
        win.setAlwaysOnTop(false);
        win.setOpacity(1);
        win.setBounds(saved.bounds);
        if (saved.maximized) win.maximize();
        win.webContents.send('app-overlay', false);
        overlayWin?.showInactive(); 
        win.minimize();
        win.hide(); 
        return;
    }
    appOverlay = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    const display = screen.getAllDisplays().find(d => d.id === overlaySettings().display) || screen.getPrimaryDisplay();
    overlayWin?.hide(); 
    if (win.isMaximized()) win.unmaximize();
    if (win.isMinimized()) win.restore();
    win.setBounds(display.bounds);
    win.setOpacity(0.96);
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver'); 
    win.focus();
    win.webContents.send('app-overlay', keyLabel('app'));
}

function registerOverlayKeys() {
    claimKey('app', proOnly(() => toggleAppOverlay('hotkey')));
    claimKey('hud', () => setOverlay({ hud: !overlaySettings().hud }));
    claimKey('crosshair', () => setOverlay({ crosshair: { on: !overlaySettings().crosshair.on } }));
}

function buildTray() {
    const menu = Menu.buildFromTemplate([
        { label: 'Open RustScout', click: showWindow },
        { type: 'separator' },
        { label: 'Link Steam account…', click: async () => { showWindow(); const r = await linkSteam(); if (!r.ok) dialog.showMessageBox(win, { type: 'error', title: 'Steam link', message: 'Couldn’t link Steam', detail: r.error }); } },
        { label: 'Start with Windows', type: 'checkbox', checked: autoStart(), click: item => setAutoStart(item.checked) },
        ...(IMPORT_OLD ? [{ label: 'Import from old version (Rust On Top)…', click: importOld }] : []),
        {
            label: `Colour profile (${colorSettings().on ? colorSettings().profiles[colorSettings().active].name : 'off'})`, submenu: [
                { label: 'Off', type: 'radio', checked: !colorSettings().on, click: () => setColor({ on: false }) },
                ...colorSettings().profiles.map((p, i) => ({ label: p.name, type: 'radio', checked: colorSettings().on && colorSettings().active === i, click: () => setColor({ on: true, active: i }) })),
                { type: 'separator' },
                { label: `${keyLabel('color')}: next profile`, enabled: false },
                { label: 'Edit profiles… (Settings tab)', click: () => { showWindow(); win?.webContents.executeJavaScript("openTab('settings'); document.getElementById('color-settings')?.scrollIntoView()").catch(() => {}); } }
            ]
        },
        {
            label: 'In-game overlay', submenu: [
                { label: `HUD (${keyLabel('hud')})`, type: 'checkbox', checked: overlaySettings().hud, click: i => setOverlay({ hud: i.checked }) },
                { label: `Crosshair (${keyLabel('crosshair')})`, type: 'checkbox', checked: overlaySettings().crosshair.on, click: i => setOverlay({ crosshair: { on: i.checked } }) },
                { label: `App over the game (${keyLabel('app')})`, click: proOnly(() => toggleAppOverlay('tray')) },
                { label: 'Customize… (Settings tab)', click: () => { showWindow(); win?.webContents.executeJavaScript("openTab('settings'); document.getElementById('overlay-settings')?.scrollIntoView()").catch(() => {}); } },
                { label: 'Borderless/windowed mode only', enabled: false }
            ]
        },
        { label: 'Open data folder', click: () => shell.openPath(USER) },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]);
    if (!tray) {
        tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
        tray.setToolTip('RustScout');
        tray.on('click', showWindow);
    }
    tray.setContextMenu(menu);
}

app.on('second-instance', showWindow);
app.on('will-quit', () => { globalShortcut.unregisterAll(); resetGamma(); });
app.on('before-quit', () => {
    quitting = true;
    try { server?.stop(); } catch {  }
});
app.on('window-all-closed', () => {  });

app.whenReady().then(async () => {
    try {
        await startServer();
    } catch (e) {
        dialog.showErrorBox('RustScout couldn’t start', e.stack || e.message);
        app.exit(1);
        return;
    }
    if (!settings().autoStartAsked) {
        saveSettings({ autoStartAsked: true });
        if (app.isPackaged && !process.env.ROT_USER_DATA) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }
    buildTray();
    registerColorKeys();
    registerOverlayKeys();
    buildTray(); 
    dlog(`started ${app.getVersion()}; hotkeys: ${JSON.stringify(KEYS)}`);
    updateOverlay();
    gammaLine(`color -1 100 50 50 1 0 ${settings().vibBase ?? -1}`).then(r => {
        if (r?.driverVibrance >= 0 && (!colorSettings().on || settings().vibBase == null)) saveSettings({ vibBase: r.driverVibrance });
        if (colorSettings().on && isPro()) applyColor();
    });
    createWindow();
});

if (process.env.ROT_USER_DATA) global.__rotTest = { importFrom, importable, importAndRestart, autoStart, toggleAppOverlay, setColor, cycleColor, colorSettings };
