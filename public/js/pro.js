window.pro = (() => {
    const BUY_URL = '';
    const LOCKED = ['#appearance-settings', '#color-settings', '#overlay-settings'];
    const q = s => document.querySelector(s);
    const ready = fetch('/api/license').then(r => r.json()).catch(() => ({ pro: false }));

    function show(l) {
        q('#pro-status').innerHTML = l.pro
            ? `<b class="ok">Pro is active</b>${l.email ? ` for ${l.email.replace(/[&<>"]/g, '')}` : ''}. Thanks for supporting RustScout!`
            : l.needsActivation ? 'Your Pro key isn’t activated on this PC yet. Click <b>Activate</b> (needs internet once). Each key works on one PC at a time.'
            : 'Pro unlocks Appearance, colour profiles and the in-game overlay (HUD, crosshair, app over the game). Each key works on one PC at a time.';
        q('#pro-enter').hidden = l.pro;
        q('#pro-remove').hidden = !l.pro && !l.needsActivation;
        q('#pro-key').placeholder = l.needsActivation ? 'Saved key (leave empty to use it)' : 'Paste your licence key (RS1-…)';
        q('#pro-buy').hidden = l.pro || !BUY_URL;
        if (BUY_URL) q('#pro-buy').href = BUY_URL;
        for (const s of LOCKED) {
            const el = q(s);
            if (!el) continue;
            el.classList.toggle('locked', !l.pro);
            if (!l.pro && !el.querySelector('.pro-lock')) el.querySelector('h2')?.insertAdjacentHTML('afterend', '<p class="pro-lock">Pro feature. Unlock it in <b>RustScout Pro</b> above.</p>');
        }
    }

    function wire() {
        ready.then(show);
        q('#pro-activate').onclick = async () => {
            q('#pro-status').textContent = 'Activating…';
            const r = await fetch('/api/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: q('#pro-key').value }) }).then(r => r.json());
            if (r.error) { q('#pro-status').textContent = r.error; return; }
            location.reload();
        };
        q('#pro-remove').onclick = async () => {
            if (!confirm('Remove the Pro key from this PC? You can then activate it on another PC.')) return;
            const r = await fetch('/api/license', { method: 'DELETE' }).then(r => r.json()).catch(() => ({ error: 'Couldn’t remove the key' }));
            if (r.error) { q('#pro-status').textContent = r.error; return; }
            location.reload();
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
    return { ready };
})();
