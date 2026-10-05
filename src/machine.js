const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

function rawId() {
    try {
        const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
        const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
        if (m) return m[1];
    } catch {  }
    return `${os.hostname()}|${os.userInfo().username}`;
}

const machineId = crypto.createHash('sha256').update(`rustscout|${rawId()}`).digest('hex').slice(0, 32);
const keyId = key => crypto.createHash('sha256').update(String(key).trim()).digest('hex').slice(0, 32);

module.exports = { machineId, keyId };
