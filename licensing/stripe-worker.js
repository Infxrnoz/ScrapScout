const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:15px system-ui;background:#0b0b0c;color:#ece7df;max-width:620px;margin:60px auto;padding:0 16px">
<h1 style="color:#e0442f">${title}</h1>${body}</body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PUBLIC_KEY = 'MCowBQYDK2VwAyEAJEjFkGTZEtEibQw8r7mmxkMlZ9vxLc9B6Rch0NqyG6U=';
const MOVES_PER_30_DAYS = 3;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

async function validKey(key) {
    const m = /^RS1-([\w-]+)\.([\w-]+)$/.exec(key);
    if (!m) return false;
    const pub = await crypto.subtle.importKey('spki', unb64url(PUBLIC_KEY.replace(/=+$/, '')), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', pub, unb64url(m[2]), new TextEncoder().encode(m[1]));
}

async function activation(request, env, action) {
    const { key, machine } = await request.json().catch(() => ({}));
    if (typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(String(machine)) || !(await validKey(key.trim()))) return json({ error: 'That key isn’t valid.' }, 400);
    const id = await sha256(key.trim());
    const rec = JSON.parse(await env.LICENSES.get(id) || 'null') || { m: null, moves: [] };
    const now = Date.now();
    const recentMoves = rec.moves.filter(t => now - t < 30 * 86400e3);
    if (action === 'deactivate') {
        if (rec.m !== machine) return json({ error: 'This key isn’t active on this PC.' }, 409);
        await env.LICENSES.put(id, JSON.stringify({ m: null, moves: [...recentMoves, now] }));
        return json({ ok: true });
    }
    if (rec.m && rec.m !== machine) return json({ error: 'This key is already activated on another PC. Remove it there first (Settings → RustScout Pro → Remove key).' }, 409);
    if (!rec.m && recentMoves.length > MOVES_PER_30_DAYS) return json({ error: 'This key has moved PCs too often this month. Try again later or contact support.' }, 429);
    await env.LICENSES.put(id, JSON.stringify({ m: machine, moves: recentMoves }));
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ k: id, m: machine, t: Math.floor(now / 1000) })));
    return json({ activation: `RA1-${payload}.${await sign(payload, env.LICENSE_PRIVATE_KEY)}` });
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
        if (url.pathname !== '/success') return page('RustScout Pro', '<p>Nothing here.</p>');
        const id = url.searchParams.get('session_id') || '';
        if (!/^cs_(live|test)_\w+$/.test(id)) return page('Hmm', '<p>That link is missing its payment id.</p>');

        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
        const session = await r.json();
        if (!r.ok || session.payment_status !== 'paid') return page('Payment not finished', '<p>Stripe hasn’t confirmed this payment yet. Refresh in a minute.</p>');

        const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: session.customer_details?.email || '', s: id, t: session.created })));
        const key = `RS1-${payload}.${await sign(payload, env.LICENSE_PRIVATE_KEY)}`;
        return page('Thanks for getting RustScout Pro!', `<p>Your licence key:</p>
<textarea readonly rows="5" style="width:100%;background:#141416;color:#ece7df;border:1px solid #37373d;border-radius:6px;padding:10px;font:13px monospace" onclick="this.select()">${esc(key)}</textarea>
<p>In RustScout: <b>Settings → RustScout Pro</b>, paste the key and click <b>Activate</b>.</p>
<p style="color:#8e8a84">Bookmark this page: opening it again shows the same key.</p>`);
    }
};
