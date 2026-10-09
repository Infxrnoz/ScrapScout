const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [email, seatsArg] = process.argv.slice(2);
const seats = Math.min(10, Math.max(1, Number(seatsArg) || 1));
if (!email) {
    console.log('Usage: node licensing/issue.js <email or name> [PCs, e.g. 4 for a quad key]');
    process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'private.pem')));
const payload = Buffer.from(JSON.stringify({ e: email, s: 'manual', t: Math.floor(Date.now() / 1000), ...(seats > 1 ? { n: seats } : {}) })).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url');
console.log(`RS1-${payload}.${sig}`);
