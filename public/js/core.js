'use strict';

const GRID = 146.25;
const S = {
    items: {}, raid: null, game: null, servers: null, snapshot: null,
    mapMeta: null, team: null, teamLog: null, info: null, time: null,
    chat: [], devices: [], pop: [], pins: []
};

const bus = {
    handlers: {},
    on(type, fn) { (this.handlers[type] ??= []).push(fn); },
    emit(type, data) {
        for (const fn of this.handlers[type] || []) {
            try { fn(data); } catch (e) { console.error(`[${type}]`, e); }
        }
    }
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itemName = id => S.items[id]?.n ?? `#${id}`;
const iconUrl = id => S.items[id] ? `https://rustlabs.com/img/items180/${S.items[id].s}.png` : '';
const icon = (id, cls = 'icon sm') => `<img class="${cls}" src="${iconUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = n => Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString();
const dur = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
};
const ago = t => {
    const s = (Date.now() - t) / 1000;
    return s < 45 ? 'just now' : `${dur(s * 1000).split(' ')[0]} ago`;
};
const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {  } }
};
const api = async (url, opts = {}) => {
    const res = await fetch(url, {
        ...opts,
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
};
function craftRaw(want) {
    const recipes = S.game.craft;
    const depthMemo = {};
    const depth = (id, seen = new Set()) => {
        if (id in depthMemo) return depthMemo[id];
        const r = recipes[id];
        if (!r || seen.has(id)) return 0;
        seen.add(id);
        return (depthMemo[id] = 1 + Math.max(0, ...r.i.map(([ing]) => depth(ing, seen))));
    };
    const need = { ...want };
    const crafts = {};
    for (let guard = 0; guard < 2000; guard++) {
        const next = Object.keys(need).filter(id => recipes[id] && need[id] > 0).sort((a, b) => depth(b) - depth(a))[0];
        if (!next) break;
        const r = recipes[next];
        const times = Math.ceil(need[next] / (r.n || 1));
        crafts[next] = (crafts[next] || 0) + times;
        delete need[next];
        for (const [ing, n] of r.i) need[ing] = (need[ing] || 0) + n * times;
    }
    return { raw: need, crafts };
}
const craftsFor = (id, qty) => Math.ceil(qty / (S.game.craft[id]?.n || 1));
const empty = text => `<div class="empty-note">${text}</div>`;

const correctedSize = size => {
    const r = size % GRID;
    return r < 120 ? size - r : size + (GRID - r);
};
const letters = n => {
    let out = '';
    n += 1;
    while (n > 0) {
        out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
};
const gridOf = (x, y) => {
    if (!S.mapMeta) return '';
    const size = correctedSize(S.mapMeta.mapSize);
    if (x < 0 || y < 0 || x > size || y > size) return 'Ocean';
    return letters(Math.floor(x / GRID)) + Math.max(0, Math.floor((size - y) / GRID));
};

const MONUMENT_NAMES = {
    AbandonedMilitaryBase: 'Abandoned Military Base', airfield_display_name: 'Airfield', arctic_base_a: 'Arctic Research Base',
    bandit_camp: 'Bandit Camp', dome_monument_name: 'The Dome', excavator: 'Giant Excavator', ferryterminal: 'Ferry Terminal',
    fishing_village_display_name: 'Fishing Village', gas_station: "Oxum's Gas Station", harbor_2_display_name: 'Harbor',
    harbor_display_name: 'Harbor', junkyard_display_name: 'Junkyard', large_fishing_village_display_name: 'Large Fishing Village',
    large_oil_rig: 'Large Oil Rig', launchsite: 'Launch Site', lighthouse_display_name: 'Lighthouse',
    military_tunnels_display_name: 'Military Tunnels', mining_outpost_display_name: 'Mining Outpost',
    mining_quarry_hqm_display_name: 'HQM Quarry', mining_quarry_stone_display_name: 'Stone Quarry',
    mining_quarry_sulfur_display_name: 'Sulfur Quarry', missile_silo_monument: 'Missile Silo', oil_rig_small: 'Oil Rig',
    outpost: 'Outpost', power_plant_display_name: 'Power Plant', satellite_dish_display_name: 'Satellite Dish',
    sewer_display_name: 'Sewer Branch', stables_a: 'Ranch', stables_b: 'Barn', supermarket: 'Supermarket',
    swamp_c: 'Swamp', train_yard_display_name: 'Train Yard', underwater_lab: 'Underwater Lab',
    water_treatment_plant_display_name: 'Water Treatment', jungle_ziggurat: 'Jungle Ziggurat', radtown: 'Radtown',
    apartmentcomplex: 'Apartment Complex'
};
function monumentName(token) {
    if (/^(train_tunnel|DungeonBase)/.test(token) || token.includes('/')) return null;
    if (MONUMENT_NAMES[token]) return MONUMENT_NAMES[token];
    return token.replace(/_display_name|_monument(_name)?$/g, '').replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
}

const map = L.map('map', {
    crs: L.CRS.Simple, minZoom: -3, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5,
    attributionControl: false, zoomControl: false
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.setMinZoom(-5);
map.setMaxZoom(2);
map.setView([0, 0], -2);
map.createPane('base').style.zIndex = 150;
map.createPane('heat').style.zIndex = 300;
map.on('zoomend', () => {
    map.getContainer().classList.toggle('far', map.getZoom() < -0.7);
    map.getContainer().classList.toggle('farther', map.getZoom() < -1.9);
});

const layers = {
    grid: L.layerGroup(), monuments: L.layerGroup(), team: L.layerGroup(),
    deaths: L.layerGroup(), notes: L.layerGroup(), pins: L.layerGroup()
};
const LAYER_NAMES = { grid: 'Grid', monuments: 'Monument names', team: 'Team', deaths: 'Team deaths', notes: 'Team map notes', pins: 'My pins & decay timers' };
const layerEnabled = key => store.get('layers', {})[key] !== false;
let mapImage = null;
const teamLayers = new Map();

const toLatLng = (x, y) => {
    const half = S.mapMeta.mapSize / 2;
    return [y - half, x - half];
};
const fromLatLng = ll => {
    const half = S.mapMeta.mapSize / 2;
    return { x: ll.lng + half, y: ll.lat + half };
};
const flyTo = (x, y, zoom = 0.75) => {
    if (!S.mapMeta || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const size = map.getSize();
    if (!size.x || !size.y || document.hidden) map.setView(toLatLng(x, y), zoom, { animate: false });
    else map.flyTo(toLatLng(x, y), zoom, { duration: 0.6 });
};

function loadMap(meta) {
    S.mapMeta = meta;
    $('#map-empty').style.display = meta ? 'none' : '';
    Object.values(layers).forEach(l => l.clearLayers());
    teamLayers.clear();
    if (mapImage) { mapImage.remove(); mapImage = null; }
    heat.reset();
    if (!meta) { bus.emit('mapLoaded'); return; }

    const { width: w, height: h, oceanMargin: m, mapSize: s } = meta;
    const mx = m * s / (w - 2 * m), my = m * s / (h - 2 * m);
    const bounds = [[-s / 2 - my, -s / 2 - mx], [s / 2 + my, s / 2 + mx]];
    mapImage = L.imageOverlay(meta.imageUrl || `/api/map.jpg?v=${meta.version}`, bounds, { className: 'map-img', pane: 'base' }).addTo(map);
    map.setMaxBounds(L.latLngBounds(bounds).pad(0.25));
    map.fitBounds(bounds, { animate: false });
    setTimeout(() => {
        map.invalidateSize();
        if (S.mapMeta === meta) map.fitBounds(bounds, { animate: false });
    }, 50);

    drawGrid();
    for (const m of meta.monuments || []) {
        const name = m.name ? (/^(Cave|Water Well)$/.test(m.name) ? null : m.name) : monumentName(m.token);
        if (!name) continue;
        L.marker(toLatLng(m.x, m.y), {
            interactive: false,
            icon: L.divIcon({ className: '', html: `<div class="mon-label">${esc(name)}</div>`, iconSize: [0, 0] })
        }).addTo(layers.monuments);
    }
    for (const key of Object.keys(layers)) if (layerEnabled(key)) layers[key].addTo(map);
    bus.emit('mapLoaded');
    renderTeamMarkers();
    renderDeathMarkers();
    heat.load(meta);
}

const HEAT_LABEL = {
    Nodes: 'All ore nodes', Hemp: 'Hemp', Berries: 'Berries', PlayerSpawns: 'Player spawns', Bears: 'Bears', Boars: 'Boars',
    Horses: 'Horses', Tigers: 'Tigers', Panthers: 'Panthers', Crocodiles: 'Crocodiles', Snakes: 'Snakes',
    Tier0: 'Terrain tier 0', Tier1: 'Terrain tier 1', Tier2: 'Terrain tier 2'
};
const HEAT_ORDER = Object.keys(HEAT_LABEL);
const HEAT_ICON = {
    Nodes: 'stones', Hemp: 'clone.hemp', Berries: 'red.berry', Bears: 'bearmeat', Boars: 'meat.boar', Horses: 'horsemeat.raw',
    Tigers: 'hat.tigermask', Panthers: null, Crocodiles: 'crocodilemeat', Snakes: 'snakemeat', PlayerSpawns: null
};
const shortIcon = (shortname, cls = 'icon') => shortname
    ? `<img class="${cls}" src="https://rustlabs.com/img/items180/${shortname}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';

const densityCache = new Map();
const DENSITY_RAMP = [
    [0.00, [20, 120, 140, 0]], [0.12, [40, 175, 190, 110]], [0.35, [70, 200, 190, 160]],
    [0.55, [235, 205, 85, 190]], [0.75, [245, 130, 45, 215]], [0.92, [225, 45, 40, 235]], [1.00, [255, 205, 195, 245]]
];

function rampColor(v) {
    for (let i = 1; i < DENSITY_RAMP.length; i++) {
        const [b, cb] = DENSITY_RAMP[i];
        if (v <= b) {
            const [a, ca] = DENSITY_RAMP[i - 1];
            const t = (v - a) / (b - a);
            return ca.map((c, k) => c + (cb[k] - c) * t);
        }
    }
    return DENSITY_RAMP[DENSITY_RAMP.length - 1][1];
}

async function densityOverlay(baseUrl, size) {
    const key = `${baseUrl}|${size}`;
    if (densityCache.has(key)) return densityCache.get(key);

    const z = -2;
    const span = 256 / 2 ** z; 
    const half = size / 2;
    const t0 = Math.floor(-half / span), t1 = Math.floor((half - 1) / span);
    const n = t1 - t0 + 1;
    const raw = document.createElement('canvas');
    raw.width = raw.height = n * 256;
    const rg = raw.getContext('2d');
    const load = src => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    const jobs = [];
    for (let tx = t0; tx <= t1; tx++) {
        for (let ty = t0; ty <= t1; ty++) {
            jobs.push(load(`/api/rmtile?u=${encodeURIComponent(`${baseUrl}${z}/${tx}/${ty}.png`)}`)
                .then(img => img && rg.drawImage(img, (tx - t0) * 256, (ty - t0) * 256)));
        }
    }
    await Promise.all(jobs);

    const result = finishDensity(raw, { m: span / 256, north: -t0 * span, west: t0 * span });
    densityCache.set(key, result);
    return result;
}

function gridDensity(key, values, res, size) {
    if (densityCache.has(key)) return densityCache.get(key);
    let max = 0;
    for (const v of values) if (v > max) max = v;
    const raw = document.createElement('canvas');
    raw.width = raw.height = res;
    const g = raw.getContext('2d');
    const img = g.createImageData(res, res);
    for (let z = 0; z < res; z++) {
        for (let x = 0; x < res; x++) {
            const v = max ? values[z * res + x] / max : 0;
            img.data[((res - 1 - z) * res + x) * 4 + 3] = Math.round(v * 255);
        }
    }
    g.putImageData(img, 0, 0);
    const result = finishDensity(raw, { m: size / res, north: size / 2, west: -size / 2 });
    densityCache.set(key, result);
    return result;
}

function finishDensity(raw, geo) {
    const m = geo.m;
    const blurred = document.createElement('canvas');
    blurred.width = blurred.height = raw.width;
    const bg = blurred.getContext('2d');
    bg.filter = `blur(${Math.max(2, Math.round(48 / m))}px)`;
    bg.drawImage(raw, 0, 0);
    const px = bg.getImageData(0, 0, blurred.width, blurred.height);
    const d = px.data;

    const hist = new Uint32Array(256);
    let count = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { hist[d[i]]++; count++; }
    let acc = 0, top = 255;
    for (let v = 255; v > 0; v--) { acc += hist[v]; if (acc > count * 0.005) { top = v; break; } }

    const W = blurred.width;
    const wide = document.createElement('canvas');
    wide.width = wide.height = W;
    const wg = wide.getContext('2d');
    wg.filter = `blur(${Math.max(4, Math.round(160 / m))}px)`;
    wg.drawImage(raw, 0, 0);
    const wd = wg.getImageData(0, 0, W, W).data;
    const candidates = [];
    let wideMax = 0;
    const step = Math.max(1, Math.round(16 / m));
    for (let y = 0; y < W; y += step) for (let x = 0; x < W; x += step) wideMax = Math.max(wideMax, wd[(y * W + x) * 4 + 3]);
    for (let y = 0; y < W; y += step) {
        for (let x = 0; x < W; x += step) {
            const v = wd[(y * W + x) * 4 + 3];
            if (v >= wideMax * 0.5) candidates.push({ x, y, v });
        }
    }
    candidates.sort((a, b) => b.v - a.v);
    const minGap = 350 / m;
    const hotspots = [];
    for (const c of candidates) {
        if (hotspots.length >= 30) break;
        if (hotspots.some(h => Math.hypot(h.x - c.x, h.y - c.y) < minGap)) continue;
        hotspots.push(c);
    }
    for (const h of hotspots) {
        h.lat = geo.north - (h.y + 0.5) * m;
        h.lng = geo.west + (h.x + 0.5) * m;
        h.v = wideMax ? h.v / wideMax : 0;
    }

    for (let i = 0; i < d.length; i += 4) {
        const v = Math.min(1, d[i + 3] / top);
        const [r, g, b, a] = v < 0.12 ? [0, 0, 0, 0] : rampColor(v);
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    bg.putImageData(px, 0, 0);

    const span = raw.width * m;
    return {
        url: blurred.toDataURL('image/png'),
        bounds: [[geo.north - span, geo.west], [geo.north, geo.west + span]],
        hotspots: hotspots.slice(0, 30)
    };
}

const heat = {
    meta: null, info: null, layer: null, retry: null, rmMonuments: L.layerGroup(),

    reset() {
        clearTimeout(this.retry);
        this.layer?.remove();
        this.layer = null;
        this.rmMonuments.clearLayers();
        this.info = null;
        this.meta = null;
        this.render();
    },

    async load(meta) {
        this.meta = meta;
        if (!meta.rustMapsId && (!meta.seed || !meta.mapSize)) { this.info = { state: 'unknown-seed' }; return this.render(); }
        this.info = { state: 'loading' };
        this.render();
        const query = meta.rustMapsId ? `id=${meta.rustMapsId}` : `size=${meta.mapSize}&seed=${meta.seed}`;
        let r;
        try { r = await api(`/api/rustmaps?${query}`); } catch (e) { r = { state: 'error', error: e.message }; }
        if (this.meta !== meta) return; 
        this.info = r.ready ? { state: 'ready', map: r.map } : r;
        if (r.ready && meta.custom && !meta.rustMapsId) {
            const match = this.matchRatio(meta, r.map);
            if (match === null) this.info.warning = 'Custom map: can’t confirm RustMaps’ data matches until the server is paired.';
            else if (match < 0.6) this.info = { state: 'custom' };
        }
        if (r.state === 'generating') this.retry = setTimeout(() => this.meta === meta && this.load(meta), 60e3);
        if (this.info.state === 'ready') this.drawMonuments();
        this.render();
        bus.emit('heatReady');
        const want = store.get('heatmap', '');
        if (want) this.show(want);
    },

    matchRatio(meta, rm) {
        const half = meta.mapSize / 2;
        const ours = (meta.monuments || []).filter(m => monumentName(m.token)).slice(0, 40);
        if (!ours.length) return null;
        const theirs = rm.monuments.filter(m => Number.isFinite(m.x)).map(m => [m.x + half, m.y + half]);
        const hits = ours.filter(m => theirs.some(([x, y]) => Math.hypot(x - m.x, y - m.y) < 80)).length;
        return hits / ours.length;
    },

    async show(name) {
        this.layer?.remove();
        this.layer = null;
        store.set('heatmap', name);
        const meta = S.mapMeta;
        if (name.startsWith('ore:') && meta) {
            const grid = resources.oreGrid(name.slice(4));
            if (grid) {
                const o = gridDensity(`${meta.levelUrl}|${name}`, grid.values, grid.res, grid.size);
                this.layer = L.imageOverlay(o.url, o.bounds, { pane: 'heat', opacity: store.get('heatOpacity', 0.75), className: 'heat-smooth' }).addTo(map);
            }
            return this.render();
        }
        const h = this.info?.map?.heatMaps.find(x => x.name === name);
        if (h && meta) {
            const s = meta.mapSize;
            const opacity = store.get('heatOpacity', 0.75);
            if (store.get('heatStyle', 'smooth') === 'smooth') {
                this.building = name;
                this.render();
                const overlay = await densityOverlay(h.url, s).catch(() => null);
                if (this.building !== name || S.mapMeta !== meta || store.get('heatmap', '') !== name) return;
                this.building = null;
                if (overlay) {
                    this.layer?.remove();
                    this.layer = L.imageOverlay(overlay.url, overlay.bounds, { pane: 'heat', opacity, className: 'heat-smooth' }).addTo(map);
                    return this.render();
                }
            }
            let p = 1;
            while (p < 1000 + s) p *= 2;
            this.layer = L.tileLayer(`${h.url}{z}/{x}/{y}.png`, {
                pane: 'heat', noWrap: true, opacity,
                minNativeZoom: 1 - Math.log2(p / 256), maxNativeZoom: 0, minZoom: -6, maxZoom: 3,
                bounds: [[-s / 2, -s / 2], [s / 2, s / 2]]
            }).addTo(map);
        }
        this.render();
    },

    drawMonuments() {
        this.rmMonuments.clearLayers();
        if (!S.mapMeta || S.mapMeta.monuments.length) return;
        const half = S.mapMeta.mapSize / 2;
        const minor = /rock|powerline|substation|iceberg|ice lake|lake|oasis|tunnel entrance|cave|water well|ruin|sphere tank|warehouse/i;
        for (const m of this.info.map.monuments) {
            if (minor.test(m.type) || !Number.isFinite(m.x)) continue;
            L.marker(toLatLng(m.x + half, m.y + half), {
                interactive: false,
                icon: L.divIcon({ className: '', html: `<div class="mon-label">${esc(m.type)}</div>`, iconSize: [0, 0] })
            }).addTo(this.rmMonuments);
        }
        this.rmMonuments.addTo(layers.monuments);
    },

    render() {
        const box = $('#heat-control');
        if (!box) return;
        const st = this.info?.state;
        const current = this.layer ? store.get('heatmap', '') : '';
        const msg = {
            'no-key': 'Add a free RustMaps API key in Settings to load heatmaps.',
            custom: 'Custom map that isn’t hosted on RustMaps, so there are no heatmaps for it. '
                + '(If the server’s map is on RustMaps, adding a Steam API key in Settings lets the app find it.)',
            'not-on-rustmaps': 'This custom map isn’t on RustMaps any more, so there are no heatmaps for it.',
            'unknown-seed': 'Map seed unknown for this server.',
            loading: 'Loading from RustMaps…',
            generating: 'RustMaps is generating this map. Checking again every minute.',
            'rate-limited': 'RustMaps rate limit hit — try again later.',
            error: esc(this.info?.error || 'RustMaps error')
        }[st];
        const have = new Set(st === 'ready' ? this.info.map.heatMaps.map(h => h.name) : []);
        const btn = name => `<button data-heat="${name}" class="heat-tile ${current === name ? 'on' : ''}">
            ${HEAT_ICON[name] ? shortIcon(HEAT_ICON[name], 'heat-ico') : `<span class="heat-badge">${{ PlayerSpawns: 'SP', Panthers: 'PA', Tier0: 'T0', Tier1: 'T1', Tier2: 'T2' }[name] || esc(name.slice(0, 2).toUpperCase())}</span>`}
            <span>${HEAT_LABEL[name] || esc(name)}</span></button>`;
        const group = (title, names) => {
            const list = names.filter(n => have.has(n));
            return list.length ? `<div class="res-group">${title}</div><div class="heat-tiles">${list.map(btn).join('')}</div>` : '';
        };
        box.classList.toggle('active', !!current || resources.active?.());
        const ORE_TILES = [['stone', 'Stone', 'stones'], ['metal', 'Metal', 'metal.ore'], ['sulfur', 'Sulfur', 'sulfur.ore'], ['hqm', 'HQM', 'hq.metal.ore'],
            ['junkpile', 'Junkpiles', 'scrap'], ['divesite', 'Dive sites', 'diving.mask']].filter(([k]) => resources.oreGrid?.(k)?.values);
        const oreBlock = resources.oreGrid?.('stone') ? `
            <div class="res-group">From the map file</div>
            <div class="heat-tiles">${ORE_TILES.map(([k, label, ico]) => `<button data-heat="ore:${k}" class="heat-tile ${current === 'ore:' + k ? 'on' : ''}">
                ${shortIcon(ico, 'heat-ico')}<span>${label}</span></button>`).join('')}</div>
            <p class="hint">Where each ore is most likely, from this server's map file and Rust's own spawn tables (stone 2 : metal 1 : sulfur 1 in forest/jungle, 1 : 1 : 1 in desert and snow; HQM is rare, most in jungle).</p>` : '';
        const noneTile = `<div class="heat-tiles"><button data-heat="" class="heat-tile ${current ? '' : 'on'}"><span class="heat-badge">⊘</span><span>None</span></button></div>`;
        $('#heat-body').innerHTML = !this.meta ? '<p class="hint">Load a map first.</p>' : msg ? `${oreBlock ? noneTile + oreBlock : ''}<p class="hint">${msg}</p>` : `
            <div class="seg heat-style">
                <button data-style="smooth" class="${store.get('heatStyle', 'smooth') === 'smooth' ? 'active' : ''}">Smooth density</button>
                <button data-style="raw" class="${store.get('heatStyle', 'smooth') === 'raw' ? 'active' : ''}">Raw spawn points</button>
            </div>
            ${this.building ? `<p class="hint">Building the ${HEAT_LABEL[this.building] || this.building} density map…</p>` : ''}
            <div class="heat-tiles"><button data-heat="" class="heat-tile ${current ? '' : 'on'}"><span class="heat-badge">⊘</span><span>None</span></button></div>
            ${oreBlock}
            ${group('Ores (RustMaps, all types)', ['Nodes'])}
            ${group('Gatherables', ['Hemp', 'Berries'])}
            ${group('Wildlife', ['Bears', 'Boars', 'Horses', 'Tigers', 'Panthers', 'Crocodiles', 'Snakes'])}
            ${group('Other', ['PlayerSpawns', 'Tier0', 'Tier1', 'Tier2'])}
            <label class="field">Opacity<input type="range" min="0.2" max="1" step="0.05" value="${store.get('heatOpacity', 0.75)}" id="heat-opacity"></label>
            ${this.info.warning ? `<p class="hint flame">${this.info.warning}</p>` : ''}
            <p class="hint">Spawn density from <a href="${esc(this.info.map.url)}" target="_blank" rel="noopener">RustMaps</a>. Shows where things spawn, not live positions.</p>`;
        $$('#heat-body [data-heat]').forEach(b => b.onclick = () => this.show(b.dataset.heat));
        $$('#heat-body [data-style]').forEach(b => b.onclick = () => {
            store.set('heatStyle', b.dataset.style);
            const cur = store.get('heatmap', '');
            cur ? this.show(cur) : this.render();
        });
        const op = $('#heat-opacity');
        if (op) op.oninput = () => { store.set('heatOpacity', +op.value); this.layer?.setOpacity(+op.value); };
    }
};

function drawGrid() {
    const size = correctedSize(S.mapMeta.mapSize);
    const cells = Math.round(size / GRID);
    const style = { color: '#000', weight: 0.6, opacity: 0.3, interactive: false };
    for (let i = 0; i <= cells; i++) {
        const v = i * GRID;
        L.polyline([toLatLng(v, 0), toLatLng(v, size)], style).addTo(layers.grid);
        L.polyline([toLatLng(0, v), toLatLng(size, v)], style).addTo(layers.grid);
    }
    for (let c = 0; c < cells; c++) {
        for (let r = 0; r < cells; r++) {
            L.marker(toLatLng(c * GRID, size - r * GRID), {
                interactive: false,
                icon: L.divIcon({ className: 'grid-label', html: `<span>${letters(c)}${r}</span>`, iconSize: [0, 0] })
            }).addTo(layers.grid);
        }
    }
}

map.on('mousemove', e => {
    if (!S.mapMeta) return;
    const { x, y } = fromLatLng(e.latlng);
    $('#cursor-readout').textContent = `${gridOf(x, y)} · ${Math.round(x)}, ${Math.round(y)}`;
});

function renderTeamMarkers() {
    if (!S.mapMeta || S.preview) return;
    const members = S.team?.members || [];
    const seen = new Set();
    for (const p of members) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.x === 0 && p.y === 0)) continue;
        seen.add(p.steamId);
        const cls = !p.isOnline ? 'offline' : !p.isAlive ? 'dead' : '';
        const html = `<div class="player-dot ${cls}"></div><div class="player-label">${esc(p.name)}</div>`;
        const ic = L.divIcon({ className: 'player-marker', html, iconSize: [14, 14], iconAnchor: [7, 7] });
        let layer = teamLayers.get(p.steamId);
        if (!layer) {
            layer = L.marker(toLatLng(p.x, p.y), { icon: ic, zIndexOffset: 1000 }).addTo(layers.team);
            teamLayers.set(p.steamId, layer);
        } else {
            layer.setLatLng(toLatLng(p.x, p.y));
            if (layer._html !== html) layer.setIcon(ic);
        }
        layer._html = html;
    }
    for (const [id, layer] of teamLayers) if (!seen.has(id)) { layer.remove(); teamLayers.delete(id); }

    layers.notes.clearLayers();
    for (const n of [...(S.team?.mapNotes || []), ...(S.team?.leaderMapNotes || [])]) {
        L.marker(toLatLng(n.x, n.y), {
            icon: L.divIcon({ className: '', html: `<div class="note-pin">${n.label ? esc(n.label) : '◆'}</div>`, iconSize: [0, 0] })
        }).addTo(layers.notes);
    }
}

function renderDeathMarkers() {
    layers.deaths.clearLayers();
    if (!S.mapMeta || S.preview) return;
    const since = Date.now() - 6 * 3600e3;
    for (const d of S.teamLog?.deaths || []) {
        if (d.t < since || !d.x) continue;
        L.marker(toLatLng(d.x, d.y), {
            icon: L.divIcon({ className: '', html: '<div class="death-mark">✕</div>', iconSize: [16, 16], iconAnchor: [8, 8] })
        }).bindTooltip(`${esc(d.name)} died ${ago(d.t)}<br>${esc(d.where)}`).addTo(layers.deaths);
    }
}

function renderInfo() {
    const pill = $('#server-pill');
    const status = S.snapshot?.status ?? 'offline';
    pill.classList.toggle('online', status === 'online');
    pill.classList.toggle('bad', status.startsWith('error') || status === 'reconnecting');
    $('#server-name').textContent = S.info?.name ?? S.snapshot?.server?.name ?? 'No server';
    $('#server-pop').textContent = S.info ? `${S.info.players}/${S.info.maxPlayers}${S.info.queuedPlayers ? ` +${S.info.queuedPlayers}` : ''}` : '';
    $('#wipe-age').textContent = S.info?.wipeTime ? `wiped ${dur(Date.now() - S.info.wipeTime * 1000)} ago` : '';
    $('#conn').textContent = status;
    $('#conn').className = `pill status ${status === 'online' ? 'ok' : status.startsWith('error') ? 'bad' : ''}`;
}

function gameClock() {
    const t = S.time;
    if (!t) return null;
    const perHour = t.secondsPerHour || 150;
    const now = (t.time + (Date.now() - t.sampledAt) / 1000 / perHour) % 24;
    const isDay = now >= t.sunrise && now < t.sunset;
    let dh = (isDay ? t.sunset : t.sunrise) - now;
    if (dh < 0) dh += 24;
    const h = Math.floor(now), m = Math.floor((now - h) * 60);
    return { now, isDay, until: dh * perHour * 1000, clock: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, t };
}

function tickClock() {
    const c = gameClock();
    if (!c) return;
    $('#clock').textContent = c.clock;
    const dn = $('#daynight');
    dn.textContent = c.isDay ? '☀ DAY' : '☾ NIGHT';
    dn.className = c.isDay ? 'day' : 'night';
    $('#sun-eta').textContent = `${c.isDay ? 'Sunset' : 'Sunrise'} ${dur(c.until)}`;
    const len = c.isDay ? c.t.sunset - c.t.sunrise : 24 - (c.t.sunset - c.t.sunrise);
    const done = c.isDay ? c.now - c.t.sunrise : (c.now - c.t.sunset + 24) % 24;
    $('#phase-bar').style.width = `${Math.min(100, Math.max(0, done / len * 100))}%`;
    $('#phase-bar').className = c.isDay ? 'day' : 'night';
}

function renderSparkline() {
    const s = S.pop.slice(-120);
    const svg = $('#pop-spark');
    if (s.length < 2) { svg.innerHTML = ''; return; }
    const max = Math.max(...s.map(p => p[3] || p[1]), 1);
    const pts = s.map((p, i) => `${(i / (s.length - 1) * 60).toFixed(1)},${(18 - p[1] / max * 16).toFixed(1)}`).join(' ');
    svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
}

setInterval(() => {
    tickClock();
}, 1000);

const ALERT_STYLE = {
    teamDeath: '#d8412f', killedBy: '#d8412f', alarm: '#ff3b30', teamOnline: '#7cc043', teamOffline: '#8d8a85',
    upkeep: '#e4a73a'
};
S.alerts = [];

let sirenCtx = null, lastRing = null;
function playSiren(seconds = 6) {
    try {
        const ctx = sirenCtx ??= new AudioContext();
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.type = 'sawtooth';
        o.connect(g).connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.1);
        for (let i = 0; i < seconds * 2; i++) {
            o.frequency.setValueAtTime(620, t + i / 2);
            o.frequency.linearRampToValueAtTime(1150, t + i / 2 + 0.45);
        }
        g.gain.setValueAtTime(0.22, t + seconds - 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
        o.start(t);
        o.stop(t + seconds);
    } catch {  }
}

function showEscalation(e) {
    $('#escalation').hidden = !e;
    if (!e) return;
    $('#esc-text').textContent = e.text;
    $('#esc-count').textContent = e.nextAt ? `next ping ${new Date(e.nextAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `pinged ${e.count}×, no more reminders`;
    const ring = `${e.startedAt}:${e.count}`;
    if (e.sound && ring !== lastRing) playSiren();
    lastRing = ring;
}
$('#esc-ack').onclick = () => api('/api/escalation/ack', { method: 'POST' }).catch(() => {});

function toast(a) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--c', ALERT_STYLE[a.kind] || '#3fa9f5');
    el.innerHTML = `<b>${esc(a.label || a.kind)}</b><span>${esc(a.text)}</span>`;
    if (Number.isFinite(a.x)) el.onclick = () => flyTo(a.x, a.y);
    $('#toasts').prepend(el);
    setTimeout(() => el.classList.add('out'), 7000);
    setTimeout(() => el.remove(), 7600);
    if (store.get('desktopNotify', !!window.desktop) && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(a.label || 'RustScout', { body: a.text, tag: `${a.kind}-${a.t}` });
        n.onclick = () => { window.desktop?.show(); window.focus(); if (Number.isFinite(a.x)) flyTo(a.x, a.y); };
    }
}

const steamLinked = () => S.servers?.fcm === 'listening';

async function linkSteam() {
    if (!window.desktop) return;
    toast({ kind: 'teamOnline', label: 'Link Steam', text: 'A Rust+ login window is opening — sign in with Steam there.' });
    const r = await window.desktop.linkSteam();
    if (!r.ok) return toast({ kind: 'alarm', label: 'Steam not linked', text: r.error });
    S.servers = await api('/api/servers');
    bus.emit('servers');
    toast({ kind: 'teamOnline', label: 'Steam linked', text: 'Now in Rust: ESC → Rust+ → Pair with server.' });
}
window.desktop?.onAppOverlay(key => {
    document.body.classList.toggle('over-game', !!key);
    if (key) document.body.dataset.backKey = key; 
});
window.desktop?.onLinkProgress(p => p.step !== 3 && toast({ kind: 'teamOnline', label: `Linking ${p.step}/4`, text: p.text }));

function renderOnboarding() {
    const box = $('#map-empty');
    if (!box || !S.servers) return;
    const linked = steamLinked();
    const step1 = linked ? '<li class="done">Steam account linked ✓</li>'
        : window.desktop ? '<li>Link your Steam account <button class="btn small" id="onboard-link">Link Steam</button></li>'
        : '<li>Link Steam: run <b>setup.bat</b> (or <code>npm run register</code>)</li>';
    const active = S.servers.list.find(v => v.id === S.servers.active);
    const st = S.snapshot?.status;
    const waiting = active && st !== 'online'
        ? st === 'not answering'
            ? `<div class="onboard"><div class="title">${esc(active.name)} isn’t answering</div>
               <p>The server accepts the connection but its Rust+ service doesn’t respond, so RustScout keeps retrying on its own (about every 45 seconds).</p>
               <ul><li>Busy servers (just after a wipe, full with a queue) often stop answering Rust+ for a while.</li>
               <li>Some servers only let the official Rust+ phone app through. If that app can’t load the map either, it’s the server.</li>
               <li>Meanwhile, the <b>Browse</b> tab still shows its map, pop and wipe.</li></ul></div>`
            : `Connecting to ${esc(active.name)}…`
        : null;
    box.innerHTML = `<div><div class="big-mark"></div>${waiting || (S.servers.list.length ? 'Pick a server in Settings to load the map.' : `
        <div class="onboard"><div class="title">Get your server on the map</div><ol>${step1}
        <li>In Rust, join your server and press <b>ESC → Rust+ → Pair with server</b></li>
        <li>It shows up here by itself within a few seconds</li></ol>
        <p class="muted">With Pro, the <b>Browse</b> tab shows any server's map without pairing.</p></div>`)}</div>`;
    $('#onboard-link')?.addEventListener('click', linkSteam);
}
bus.on('servers', renderOnboarding);
bus.on('status', renderOnboarding);
bus.on('reset', renderOnboarding);

function openTab(name) {
    const panel = $('#panel');
    $$('.rail button[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    $$('#panel > section').forEach(s => s.classList.toggle('active', s.dataset.panel === name));
    panel.classList.remove('collapsed');
    store.set('tab', name);
    bus.emit(`tab:${name}`);
    setTimeout(() => map.invalidateSize(), 0);
}
$$('.rail button[data-panel]').forEach(btn => btn.onclick = () => {
    if (btn.classList.contains('active') && !$('#panel').classList.contains('collapsed')) {
        $('#panel').classList.add('collapsed');
        setTimeout(() => map.invalidateSize(), 0);
    } else {
        openTab(btn.dataset.panel);
    }
});
$('#panel-toggle').onclick = () => {
    $('#panel').classList.toggle('collapsed');
    setTimeout(() => map.invalidateSize(), 0);
};
bus.on('tab:breeder', () => $('#panel').classList.add('wide'));
bus.on('tab:power', () => $('#panel').classList.add('wide'));
for (const t of ['browse', 'shops', 'raid', 'team', 'threats', 'tracked', 'events', 'devices', 'chat', 'tools', 'recycle', 'settings']) {
    bus.on(`tab:${t}`, () => $('#panel').classList.remove('wide'));
}

function applySnapshot(snap) {
    S.snapshot = snap;
    S.info = snap?.info ?? null;
    S.time = snap?.time ?? null;
    S.team = snap?.team ?? null;
    S.teamLog = snap?.teamLog ?? null;
    S.chat = snap?.chat ?? [];
    S.devices = snap?.devices ?? [];
    S.pins = snap?.pins ?? [];
    S.automations = snap?.automations ?? [];
    renderInfo();
    if (!S.preview) loadMap(snap?.mapMeta ?? null);
    api('/api/pop').then(p => { S.pop = p; renderSparkline(); }).catch(() => {});
    bus.emit('reset');
}

function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
            case 'servers': S.servers = msg.servers; bus.emit('servers'); break;
            case 'reset': applySnapshot(msg.snapshot); break;
            case 'status': if (S.snapshot) S.snapshot.status = msg.status; renderInfo(); bus.emit('status'); break;
            case 'info':
                S.info = msg.info;
                renderInfo();
                S.pop.push([Date.now(), msg.info.players, msg.info.queuedPlayers, msg.info.maxPlayers]);
                renderSparkline();
                break;
            case 'map':
                if (S.snapshot) S.snapshot.mapMeta = msg.mapMeta;
                if (S.preview?.fallback) { S.preview = null; $('#preview-banner').classList.remove('on'); }
                if (!S.preview) loadMap(msg.mapMeta);
                break;
            case 'fallback': if (S.snapshot) S.snapshot.fallback = msg.fallback; bus.emit('fallback'); break;
            case 'watch': bus.emit('watch'); break;
            case 'time': S.time = msg.time; tickClock(); bus.emit('time'); break;
            case 'team':
                S.team = msg.team;
                S.teamLog = msg.teamLog;
                renderTeamMarkers();
                renderDeathMarkers();
                bus.emit('team');
                break;
            case 'chat': S.chat = msg.chat; bus.emit('chat'); break;
            case 'chatMessage': S.chat.push(msg.message); bus.emit('chat', msg.message); break;
            case 'devices': S.devices = msg.devices; bus.emit('devices'); break;
            case 'pins': S.pins = msg.pins; bus.emit('pins'); break;
            case 'automations': S.automations = msg.automations; bus.emit('automations'); break;
            case 'threatsChanged': bus.emit('threatsChanged'); break;
            case 'escalation':
                showEscalation(msg.escalation);
                if (!msg.escalation && msg.by) toast({ kind: 'teamOnline', label: 'Raid alarm answered', text: `${msg.by} is on it` });
                break;
            case 'alert':
                S.alerts.unshift(msg.alert);
                S.alerts = S.alerts.slice(0, 200);
                if (msg.toast) toast(msg.alert);
                bus.emit('alert', msg.alert);
                break;
        }
    };
    ws.onopen = () => $('#backend').classList.remove('down');
    ws.onclose = () => {
        $('#backend').classList.add('down');
        setTimeout(connect, 3000);
    };
}

function showUpdate(u) {
    const b = $('#update-pill');
    b.hidden = !u;
    if (!u) return;
    b.textContent = `⬆ Update ${u.version} ready · restart`;
    b.title = 'RustScout restarts in a few seconds with the new version';
    b.onclick = () => window.desktop.updateInstall();
}
window.desktop?.updateGet?.().then(showUpdate).catch(() => {});
window.desktop?.onUpdateReady?.(showUpdate);

async function boot() {
    [S.items, S.raid, S.game] = await Promise.all(['items', 'raid', 'game'].map(f => fetch(`/data/${f}.json`).then(r => r.json())));
    bus.emit('ready');
    openTab(document.querySelector(`.rail button[data-panel="${store.get('tab', 'team')}"]`) ? store.get('tab', 'team') : 'team');
    connect();
}
