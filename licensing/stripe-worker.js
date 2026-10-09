const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' };
const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:15px system-ui;background:#0b0b0c;color:#ece7df;max-width:620px;margin:60px auto;padding:0 16px">
<h1 style="color:#e0442f">${title}</h1>${body}</body>`, { headers: { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PUBLIC_KEY = 'MCowBQYDK2VwAyEAJEjFkGTZEtEibQw8r7mmxkMlZ9vxLc9B6Rch0NqyG6U=';
const MOVES_PER_30_DAYS = 3;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...SECURITY, 'Content-Type': 'application/json' } });
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

async function readKey(key) {
    const m = /^RS1-([\w-]+)\.([\w-]+)$/.exec(key);
    if (!m) return null;
    const pub = await crypto.subtle.importKey('spki', unb64url(PUBLIC_KEY.replace(/=+$/, '')), { name: 'Ed25519' }, false, ['verify']);
    if (!(await crypto.subtle.verify('Ed25519', pub, unb64url(m[2]), new TextEncoder().encode(m[1])))) return null;
    let p;
    try { p = JSON.parse(new TextDecoder().decode(unb64url(m[1]))); } catch { return null; }
    return typeof p.e === 'string' && typeof p.s === 'string' && p.m === undefined ? p : null;
}
const validKey = async key => !!(await readKey(key));
const seatsOf = p => Math.min(10, Math.max(1, Math.floor(Number(p.n) || 1)));

async function activation(request, env, action) {
    const { key, machine } = await request.json().catch(() => ({}));
    const p = typeof key === 'string' && /^[0-9a-f]{32}$/.test(String(machine)) ? await readKey(key.trim()) : null;
    if (!p) return json({ error: 'That key isn’t valid.' }, 400);
    const seats = seatsOf(p);
    const id = await sha256(key.trim());
    const rec = JSON.parse(await env.LICENSES.get(id) || 'null') || { moves: [] };
    const machines = rec.ms || (rec.m ? [rec.m] : []);
    const now = Date.now();
    const recentMoves = (rec.moves || []).filter(t => now - t < 30 * 86400e3);
    const save = (ms, moves) => {
        const { m, ...rest } = rec;
        return env.LICENSES.put(id, JSON.stringify({ ...rest, ms, moves }));
    };
    if (action === 'deactivate') {
        if (!machines.includes(machine)) return json({ error: 'This key isn’t active on this PC.' }, 409);
        await save(machines.filter(x => x !== machine), [...recentMoves, now]);
        return json({ ok: true });
    }
    if (rec.revoked) return json({ error: 'This key has been disabled. Contact support if you think that’s a mistake.' }, 403);
    if (!machines.includes(machine)) {
        if (machines.length >= seats) {
            return json({ error: seats === 1
                ? 'This key is already activated on another PC. Remove it there first (Settings → RustScout Pro → Remove key).'
                : `This key is already on ${seats} PCs, the most it covers. Remove it from one of them first.` }, 409);
        }
        if (recentMoves.length > MOVES_PER_30_DAYS * seats) return json({ error: 'This key has moved PCs too often this month. Try again later or contact support.' }, 429);
        await save([...machines, machine], recentMoves);
    }
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ k: id, m: machine, t: Math.floor(now / 1000) })));
    return json({ activation: `RA1-${payload}.${await sign(payload, env.LICENSE_PRIVATE_KEY)}` });
}

async function stripe(env, path) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    return r.ok ? r.json() : null;
}

const teamLinks = env => { try { return JSON.parse(env.TEAM_LINKS || '{}'); } catch { return {}; } };
const seatsFor = (session, env) => Number(teamLinks(env)[session.payment_link]) || 1;

async function keyFor(session, env) {
    const seats = seatsFor(session, env);
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: session.customer_details?.email || '', s: session.id, t: session.created, ...(seats > 1 ? { n: seats } : {}) })));
    return `RS1-${payload}.${await sign(payload, env.LICENSE_PRIVATE_KEY)}`;
}

const ours = (session, env) => (!env.PAYMENT_LINK_ID && !env.TEAM_LINKS) || session.payment_link === env.PAYMENT_LINK_ID || seatsFor(session, env) > 1;

async function revoke(env, id) {
    const rec = JSON.parse(await env.LICENSES.get(id) || 'null') || { m: null, moves: [] };
    await env.LICENSES.put(id, JSON.stringify({ ...rec, revoked: true }));
}

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const sameText = (a, b) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

async function stripeWebhook(request, env) {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Not set up' }, 404);
    const body = await request.text();
    const header = request.headers.get('Stripe-Signature') || '';
    const t = /(?:^|,)t=(\d+)/.exec(header)?.[1];
    const sigs = [...header.matchAll(/(?:^|,)v1=([0-9a-f]{64})/g)].map(m => m[1]);
    if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return json({ error: 'Bad signature' }, 400);
    const mac = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = hex(await crypto.subtle.sign('HMAC', mac, new TextEncoder().encode(`${t}.${body}`)));
    if (!sigs.some(s => sameText(s, expected))) return json({ error: 'Bad signature' }, 400);

    const event = JSON.parse(body);
    const obj = event.data?.object || {};
    const lost = (event.type === 'charge.refunded' && obj.refunded) || event.type === 'charge.dispute.created';
    if (lost && obj.payment_intent) {
        const list = await stripe(env, `checkout/sessions?payment_intent=${encodeURIComponent(obj.payment_intent)}`);
        for (const session of list?.data || []) await revoke(env, await sha256(await keyFor(session, env)));
    }
    return json({ received: true });
}

async function sign(text, pem) {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text)));
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'POST' && (url.pathname === '/activate' || url.pathname === '/deactivate')) return activation(request, env, url.pathname.slice(1));
        if (request.method === 'POST' && url.pathname === '/stripe-webhook') return stripeWebhook(request, env);
        if (url.pathname !== '/success') return page('RustScout Pro', '<p>Nothing here.</p>');
        const id = url.searchParams.get('session_id') || '';
        if (!/^cs_(live|test)_\w+$/.test(id)) return page('Hmm', '<p>That link is missing its payment id.</p>');

        const session = await stripe(env, `checkout/sessions/${id}`);
        if (!session || session.payment_status !== 'paid') return page('Payment not finished', '<p>Stripe hasn’t confirmed this payment yet. Refresh in a minute.</p>');
        if (!ours(session, env)) return page('Hmm', '<p>That payment isn’t for RustScout Pro.</p>');

        const key = await keyFor(session, env);
        const rec = JSON.parse(await env.LICENSES.get(await sha256(key)) || 'null');
        if (rec?.revoked) return page('Key disabled', '<p>This purchase was refunded or disputed, so its key no longer works. If that’s a mistake, open a ticket in our Discord.</p>');
        return page('Thanks for getting RustScout Pro!', `<p>Your licence key:</p>
<textarea readonly rows="5" style="width:100%;background:#141416;color:#ece7df;border:1px solid #37373d;border-radius:6px;padding:10px;font:13px monospace">${esc(key)}</textarea>
<p>In RustScout: <b>Settings → RustScout Pro</b>, paste the key and click <b>Activate</b>.${seatsFor(session, env) > 1 ? ` This is a team key: share it with your team, it works on ${seatsFor(session, env)} PCs at once.` : ''}</p>
<p style="color:#8e8a84">Bookmark this page: opening it again shows the same key.</p>`);
    }
};
