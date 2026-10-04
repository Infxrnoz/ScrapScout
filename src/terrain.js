const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RES = 512;
const MAX_DOWNLOAD = 400 * 1048576;
const pending = new Map();

function varint(buf, pos) {
    let v = 0, shift = 0, b;
    do { b = buf[pos++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return [v, pos];
}

function lz4Block(src, dstLen) {
    const dst = Buffer.alloc(dstLen);
    let si = 0, di = 0;
    while (si < src.length) {
        const token = src[si++];
        let lit = token >> 4;
        if (lit === 15) { let b; do { b = src[si++]; lit += b; } while (b === 255); }
        src.copy(dst, di, si, si + lit);
        si += lit; di += lit;
        if (si >= src.length) break;
        const off = src[si] | (src[si + 1] << 8);
        si += 2;
        let ml = token & 15;
        if (ml === 15) { let b; do { b = src[si++]; ml += b; } while (b === 255); }
        ml += 4;
        for (let k = 0; k < ml; k++, di++) dst[di] = dst[di - off];
    }
    return dst.subarray(0, di);
}

function decompress(file) {
    let pos = file.readUInt32LE(0) >= 9 ? 12 : 4;
    const parts = [];
    while (pos < file.length) {
        let flags, orig, comp;
        [flags, pos] = varint(file, pos);
        [orig, pos] = varint(file, pos);
        if (flags & 1) {
            [comp, pos] = varint(file, pos);
            parts.push(lz4Block(file.subarray(pos, pos + comp), orig));
            pos += comp;
        } else {
            parts.push(file.subarray(pos, pos + orig));
            pos += orig;
        }
    }
    return Buffer.concat(parts);
}

function readVector(buf) {
    const v = [0, 0, 0];
    let q = 0;
    while (q < buf.length) {
        let k;
        [k, q] = varint(buf, q);
        if ((k & 7) === 5) { v[(k >> 3) - 1] = buf.readFloatLE(q); q += 4; } else if ((k & 7) === 0) { [, q] = varint(buf, q); } else break;
    }
    return v;
}

function readPrefab(body) {
    let q = 0;
    const p = { id: 0, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
    while (q < body.length) {
        let k;
        [k, q] = varint(body, q);
        const f = k >> 3;
        if ((k & 7) === 0) { let v; [v, q] = varint(body, q); if (f === 2) p.id = v; continue; }
        let l;
        [l, q] = varint(body, q);
        const sub = body.subarray(q, q + l);
        if (f === 3) p.pos = readVector(sub); else if (f === 4) p.rot = readVector(sub); else if (f === 5) p.scale = readVector(sub);
        q += l;
    }
    return p;
}

function readLayers(data, wantIds, full = false) {
    let p = 0, size = 0;
    const layers = {};
    const prefabs = [];
    while (p < data.length) {
        let key;
        [key, p] = varint(data, p);
        const field = Math.floor(key / 8), wire = key & 7;
        if (wire === 0) { let v; [v, p] = varint(data, p); if (field === 1) size = v; continue; }
        let len;
        [len, p] = varint(data, p);
        if (field === 3 && wantIds) {
            const pf = readPrefab(data.subarray(p, p + len));
            if (wantIds.has(pf.id)) prefabs.push(pf);
        }
        if (field === 2) {
            const body = data.subarray(p, p + len);
            let q = 0, name = '', bytes = null;
            while (q < body.length) {
                let k, l;
                [k, q] = varint(body, q);
                [l, q] = varint(body, q);
                if ((k >> 3) === 1) name = body.toString('utf8', q, q + l); else bytes = body.subarray(q, q + l);
                q += l;
            }
            if (name === 'biome' || name === 'topology' || name === 'splat' || (full && (name === 'height' || name === 'water'))) layers[name] = bytes;
        }
        p += len;
    }
    return { size, layers, prefabs };
}

function eulerQuat([ex, ey, ez]) {
    const r = Math.PI / 180;
    const [hx, hy, hz] = [ex * r / 2, ey * r / 2, ez * r / 2];
    const qx = [Math.sin(hx), 0, 0, Math.cos(hx)], qy = [0, Math.sin(hy), 0, Math.cos(hy)], qz = [0, 0, Math.sin(hz), Math.cos(hz)];
    const mul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    return mul(mul(qy, qx), qz);
}

function rotate([x, y, z, w], [vx, vy, vz]) {
    const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

function placeFacilities(prefabs, facilities, size) {
    const out = [];
    for (const pf of prefabs) {
        const mon = facilities.monuments[String(pf.id)];
        if (!mon) continue;
        const q = eulerQuat(pf.rot);
        const name = mon.path.split('/').pop().replace('.prefab', '');
        for (const it of mon.items) {
            const [dx, , dz] = rotate(q, [it.x * pf.scale[0], it.y * pf.scale[1], it.z * pf.scale[2]]);
            out.push({ t: it.t, x: +(pf.pos[0] + dx + size / 2).toFixed(1), y: +(pf.pos[2] + dz + size / 2).toFixed(1), m: name });
        }
    }
    return out;
}

const ORE_KINDS = ['stone', 'metal', 'sulfur', 'hqm', 'junkpile', 'divesite'];
const SPAWN_KIND = { junkpiles: 'junkpile', divesites: 'divesite' };
function oreModel(layers, tables, spawnTables) {
    const topoRes = Math.round(Math.sqrt(layers.topology.length / 4));
    const biomeCh = Math.round(layers.biome.length / (topoRes * topoRes)) || 4;
    const biomeRes = Math.round(Math.sqrt(layers.biome.length / biomeCh));
    const splatRes = Math.round(Math.sqrt(layers.splat.length / 8));
    const out = Object.fromEntries(ORE_KINDS.map(k => [k, new Float32Array(RES * RES)]));
    const pops = Object.values(tables.populations).map(p => {
        const mix = tables.folders[p.folder];
        const total = Object.values(mix).reduce((a, b) => a + b, 0);
        return { ...p, shares: ORE_KINDS.map(k => (mix[k] || 0) / total) };
    });
    for (const [name, p] of Object.entries(spawnTables?.populations || {})) {
        if (SPAWN_KIND[name]) pops.push({ ...p, shares: ORE_KINDS.map(k => (k === SPAWN_KIND[name] ? 1 : 0)) });
    }
    const maskSum = (buf, res, channels, mask, z, x) => {
        if (mask === -1) return 1;
        let s = 0;
        for (let c = 0; c < channels; c++) if (mask & (1 << c)) s += buf[(c * res + z) * res + x];
        return Math.min(1, s / 255);
    };
    for (let z = 0; z < topoRes; z++) {
        const bz = Math.floor((z + 0.5) / topoRes * biomeRes), sz = Math.floor((z + 0.5) / topoRes * splatRes);
        const oz = Math.floor(z / topoRes * RES);
        for (let x = 0; x < topoRes; x++) {
            const t = layers.topology.readInt32LE((z * topoRes + x) * 4);
            const bx = Math.floor((x + 0.5) / topoRes * biomeRes), sx = Math.floor((x + 0.5) / topoRes * splatRes);
            const o = oz * RES + Math.floor(x / topoRes * RES);
            for (const p of pops) {
                if (p.topologyAny && !(t & p.topologyAny)) continue;
                if (p.topologyAll && (t & p.topologyAll) !== p.topologyAll) continue;
                if (t & p.topologyNot) continue;
                const f = maskSum(layers.biome, biomeRes, biomeCh, p.biome, bz, bx) * maskSum(layers.splat, splatRes, 8, p.splat, sz, sx);
                if (!f) continue;
                for (let k = 0; k < ORE_KINDS.length; k++) if (p.shares[k]) out[ORE_KINDS[k]][o] += p.density * f * p.shares[k];
            }
        }
    }
    return out;
}

function extract(file, oreTables, spawnTables, facilityTable, opts = {}) {
    let wantIds = facilityTable ? new Set(Object.keys(facilityTable.monuments).map(Number)) : null;
    if (opts.monumentNames) {
        wantIds ||= new Set();
        for (const id of Object.keys(opts.monumentNames)) wantIds.add(Number(id));
    }
    const { size, layers, prefabs } = readLayers(decompress(file), wantIds, !!opts.preview);
    if (!layers.biome || !layers.topology || !layers.splat) throw new Error('map file is missing biome/splat/topology layers');
    const topoRes = Math.round(Math.sqrt(layers.topology.length / 4));
    const biomeCh = Math.round(layers.biome.length / (topoRes * topoRes)) || 4;
    const biomeRes = Math.round(Math.sqrt(layers.biome.length / biomeCh));
    const splatCh = 8;
    const splatRes = Math.round(Math.sqrt(layers.splat.length / splatCh));
    const N = RES * RES;
    const ores = oreTables ? oreModel(layers, oreTables, spawnTables) : null;
    const out = Buffer.alloc(16 + N * (biomeCh + splatCh + 4) + (ores ? N * 4 * ORE_KINDS.length : 0));
    out.writeUInt32LE(RES, 0);
    out.writeUInt32LE(size, 4);
    out.writeUInt32LE(biomeCh, 8);
    out.writeUInt32LE(splatCh, 12);
    const biomeAt = 16, splatAt = biomeAt + N * biomeCh, topoAt = splatAt + N * splatCh;
    const pick = (res, z, x) => [Math.floor((z + 0.5) / RES * res), Math.floor((x + 0.5) / RES * res)];
    for (let z = 0; z < RES; z++) {
        for (let x = 0; x < RES; x++) {
            const i = z * RES + x;
            const [bz, bx] = pick(biomeRes, z, x);
            for (let c = 0; c < biomeCh; c++) out[biomeAt + c * N + i] = layers.biome[(c * biomeRes + bz) * biomeRes + bx];
            const [sz, sx] = pick(splatRes, z, x);
            for (let c = 0; c < splatCh; c++) out[splatAt + c * N + i] = layers.splat[(c * splatRes + sz) * splatRes + sx];
            const [tz, tx] = pick(topoRes, z, x);
            out.writeInt32LE(layers.topology.readInt32LE((tz * topoRes + tx) * 4), topoAt + i * 4);
        }
    }
    if (ores) {
        const oreAt = topoAt + N * 4;
        ORE_KINDS.forEach((k, n) => Buffer.from(ores[k].buffer).copy(out, oreAt + n * N * 4));
    }
    const result = { grid: out, size, facilities: facilityTable ? placeFacilities(prefabs, facilityTable, size) : [] };
    if (opts.monumentNames) {
        result.monuments = prefabs.filter(pf => opts.monumentNames[pf.id])
            .map(pf => ({ name: opts.monumentNames[pf.id], x: +(pf.pos[0] + size / 2).toFixed(1), y: +(pf.pos[2] + size / 2).toFixed(1) }));
    }
    if (opts.preview && layers.height) result.preview = require('./maprender').render(layers, opts.preview);
    return result;
}

const FILE_KEY = /^mapfile:([0-9a-f]{40})$/;

async function loadFile(buf, cacheDir, tables = {}, name = 'map') {
    if (!Buffer.isBuffer(buf) || buf.length < 64 || buf.length > MAX_DOWNLOAD) throw new Error('That doesn’t look like a Rust .map file');
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    const base = path.join(cacheDir, hash);
    const metaFile = base + '.mapfile.json';
    if (fs.existsSync(metaFile) && fs.existsSync(base + '.terrain5')) {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        meta.opened = Date.now();
        fs.writeFileSync(metaFile, JSON.stringify(meta));
        return meta;
    }
    let result;
    try {
        result = extract(buf, tables.ores, tables.spawns, tables.facilities, { monumentNames: tables.monuments, preview: 2048 });
    } catch (e) {
        throw new Error(`That file isn’t a readable Rust map — it may be damaged or only partly downloaded (${e.message}).`);
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(base + '.terrain5', result.grid);
    fs.writeFileSync(base + '.facilities5.json', JSON.stringify(result.facilities));
    if (result.preview) fs.writeFileSync(base + '.preview.png', result.preview);
    const meta = {
        id: hash, key: `mapfile:${hash}`, name: String(name).replace(/\.map$/i, '').slice(0, 120), size: result.size,
        bytes: buf.length, monuments: result.monuments || [], facilities: result.facilities.length, opened: Date.now()
    };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    return meta;
}

function listFiles(cacheDir) {
    if (!fs.existsSync(cacheDir)) return [];
    return fs.readdirSync(cacheDir).filter(f => f.endsWith('.mapfile.json'))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.opened - a.opened);
}

function removeFile(cacheDir, hash) {
    if (!/^[0-9a-f]{40}$/.test(hash)) return;
    for (const ext of ['.mapfile.json', '.terrain5', '.facilities5.json', '.preview.png']) fs.rmSync(path.join(cacheDir, hash + ext), { force: true });
}

async function load(url, cacheDir, tables = {}) {
    const fileKey = url.match(FILE_KEY);
    const base = path.join(cacheDir, fileKey ? fileKey[1] : crypto.createHash('sha1').update(url).digest('hex'));
    if (fileKey && !fs.existsSync(base + '.terrain5')) throw new Error('That map file is no longer cached — open it again');
    const gridFile = base + '.terrain5', facFile = base + '.facilities5.json';
    if (fs.existsSync(gridFile) && fs.existsSync(facFile)) {
        return { grid: fs.readFileSync(gridFile), facilities: JSON.parse(fs.readFileSync(facFile, 'utf8')) };
    }
    if (pending.has(url)) return pending.get(url);
    const job = (async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
        if (!res.ok) throw new Error(`map download failed (${res.status})`);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > MAX_DOWNLOAD) throw new Error('map file too large');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_DOWNLOAD) throw new Error('map file too large');
        const result = extract(buf, tables.ores, tables.spawns, tables.facilities);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(gridFile, result.grid);
        fs.writeFileSync(facFile, JSON.stringify(result.facilities));
        return result;
    })();
    pending.set(url, job);
    try { return await job; } finally { pending.delete(url); }
}

module.exports = { load, loadFile, listFiles, removeFile, extract, RES, FILE_KEY };
