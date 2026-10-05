const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const email = process.argv[2];
if (!email) {
    console.log('Usage: node licensing/issue.js <email or name>');
    process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'private.pem')));
const payload = Buffer.from(JSON.stringify({ e: email, s: 'manual', t: Math.floor(Date.now() / 1000) })).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url');
console.log(`RS1-${payload}.${sig}`);
