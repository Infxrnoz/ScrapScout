const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const notes = process.argv.slice(2).join(' ').trim();
if (!notes) {
    console.log('Usage: node scripts/release.js "What changed in this version"');
    process.exit(1);
}
const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const repo = 'Infxrnoz/ScrapScout';
const dist = path.join(root, 'dist-app');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });

run('npm', ['run', 'dist']);
const exe = path.join(dist, `ScrapScout-Setup-${version}.exe`);
const files = [exe, `${exe}.blockmap`, path.join(dist, 'latest.yml')];
for (const f of files) if (!fs.existsSync(f)) throw new Error(`missing build output: ${f}`);
if (!fs.readFileSync(files[2], 'utf8').includes(`version: ${version}`)) throw new Error('latest.yml does not match package.json version');

const fixed = path.join(os.tmpdir(), 'ScrapScout-Setup.exe');
fs.copyFileSync(exe, fixed);
try {
    run('gh', ['release', 'create', `v${version}`, ...files.map(f => `"${f}"`), `"${fixed}"`, '-R', repo, '--title', `"ScrapScout ${version}"`, '--notes', JSON.stringify(notes), '--latest']);
} finally {
    fs.rmSync(fixed, { force: true });
}
console.log(`\nReleased ${version}. Installed copies update themselves within 6 hours; the website download now serves ${version}.`);
