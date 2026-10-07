const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');

const [key, flag] = process.argv.slice(2);
if (!/^RS1-[\w-]+\.[\w-]+$/.test(key || '')) {
    console.log('Usage: node licensing/revoke.js RS1-... [--undo]');
    process.exit(1);
}
const id = crypto.createHash('sha256').update(key.trim()).digest('hex').slice(0, 32);
const ns = /id\s*=\s*"(\w+)"/.exec(require('fs').readFileSync(path.join(__dirname, 'wrangler.toml'), 'utf8'))[1];
const wrangler = (...args) => execFileSync('npx', ['wrangler', 'kv', 'key', ...args, `--namespace-id=${ns}`, '--remote'], { cwd: __dirname, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });

let rec = { m: null, moves: [] };
try { rec = JSON.parse(wrangler('get', id)); } catch {}
if (flag === '--undo') delete rec.revoked; else rec.revoked = true;
const tmp = path.join(require('os').tmpdir(), `rustscout-revoke-${id}.json`);
require('fs').writeFileSync(tmp, JSON.stringify(rec));
try { wrangler('put', id, `--path="${tmp}"`); } finally { require('fs').rmSync(tmp, { force: true }); }
console.log(flag === '--undo' ? 'Key works again.' : 'Key disabled. The app turns Pro off within 12 hours, or on its next start.');
