'use strict';

(() => {
    function renderAlerts() {
        $('#alert-log').innerHTML = S.alerts.slice(0, 60).map(a => `
            <div class="log-row" style="--c:${ALERT_STYLE[a.kind] || '#3fa9f5'}"><span class="ic dot"></span>
            <span class="grow"><b>${esc(a.label)}</b> ${esc(a.text)}</span><span class="muted">${ago(a.t)}</span></div>`).join('')
            || empty('Alerts from this session appear here.');
    }

    function renderLayerToggles() {
        $('#layer-toggles').innerHTML = Object.entries(LAYER_NAMES).map(([k, name]) =>
            `<label class="check"><input type="checkbox" data-layer="${k}" ${layerEnabled(k) ? 'checked' : ''}> ${name}</label>`).join('');
        $$('#layer-toggles input').forEach(cb => cb.onchange = () => {
            const saved = store.get('layers', {});
            saved[cb.dataset.layer] = cb.checked;
            store.set('layers', saved);
            if (S.mapMeta) cb.checked ? layers[cb.dataset.layer].addTo(map) : layers[cb.dataset.layer].remove();
        });
    }

    bus.on('alert', renderAlerts);
    bus.on('ready', () => { renderLayerToggles(); renderAlerts(); });
})();
