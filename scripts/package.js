const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'ScrapScout');

const INCLUDE = [
    'server.js', 'package.json', 'package-lock.json', 'README.md', 'SETUP.md', 'setup.bat', 'start.bat',
    'src', 'public', 'vendor',
    'scripts/register.js', 'scripts/build-data.js', 'scripts/import-rustplusplus.js', 'scripts/package.js',
    'data/items.json', 'data/raid.json', 'data/game.json', 'data/ores.json', 'data/spawns.json', 'data/facilities.json', 'data/craft-yields.json', 'data/monuments.json',
    'scripts/extract-ore-tables.py', 'scripts/extract-game-data.py', 'scripts/install-linux-service.sh',
    'HOSTING.md', 'start-background.vbs', 'stop.bat', 'autostart-on.bat', 'autostart-off.bat'
];
const NEVER = /(^|[\\/])(config\.json|rustplus\.config\.json|servers\.json|threats\.json|watch\.json|tracked\.json|pins\.json|fcm-seen\.json|app\.(pid|log)|[^\\/]*\.tmp)$/;

fs.rmSync(DIST, { recursive: true, force: true });
for (const rel of INCLUDE) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`missing ${rel}`);
    fs.cpSync(src, path.join(STAGE, rel), { recursive: true, filter: s => !NEVER.test(s) });
}

const zip = path.join(DIST, 'ScrapScout.zip');
execFileSync('tar', ['-a', '-c', '-f', zip, '-C', DIST, 'ScrapScout']);
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`Built ${path.relative(ROOT, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
