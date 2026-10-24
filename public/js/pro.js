// Every feature is free in ScrapScout. This shim keeps the old Pro API alive so the
// rest of the UI (S.pro, bus 'pro', window.pro.ready) works without changes.
window.pro = (() => {
    const LOCKED = ['#appearance-settings', '#color-settings', '#overlay-settings', '#discord-settings', '#escalation-settings', '#phone-settings',
        ...['browse', 'raid', 'tracked', 'tools', 'recycle', 'breeder', 'power', 'display', 'cameras'].map(p => `section[data-panel="${p}"]`)];

    function unlock() {
        S.pro = true;
        bus.emit('pro');
        for (const sel of LOCKED) {
            const el = document.querySelector(sel);
            if (!el) continue;
            el.classList.remove('locked');
            el.querySelectorAll('.pro-lock').forEach(n => n.remove());
        }
        const heat = document.querySelector('#heat-control');
        if (heat) heat.hidden = false;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', unlock);
    else unlock();

    return { ready: Promise.resolve({ pro: true }) };
})();
