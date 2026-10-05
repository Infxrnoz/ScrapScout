const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { machineId, keyId } = require('../src/machine');

const configFile = path.join(process.env.APPDATA, 'RustScout', 'config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const key = process.argv[2] || config.licenseKey;
if (!key) {
    console.log('No key. Usage: node licensing/activate-here.js [RS1-key]');
    process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'private.pem')));
const payload = Buffer.from(JSON.stringify({ k: keyId(key), m: machineId, t: Math.floor(Date.now() / 1000) })).toString('base64url');
config.licenseKey = key.trim();
config.licenseActivation = `RA1-${payload}.${crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
console.log('Activated on this PC. Restart RustScout.');
