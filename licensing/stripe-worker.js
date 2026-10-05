const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:15px system-ui;background:#0b0b0c;color:#ece7df;max-width:620px;margin:60px auto;padding:0 16px">
<h1 style="color:#e0442f">${title}</h1>${body}</body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(text, pem) {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text)));
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
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
