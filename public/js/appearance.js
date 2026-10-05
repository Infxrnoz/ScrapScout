(() => {
    const THEMES = {
        rust: { accent: '#e0442f', accent2: '#ff7a2f' },
        midnight: { accent: '#4c7dff', accent2: '#8ab4ff' },
        toxic: { accent: '#39d353', accent2: '#a6ff4d' },
        sakura: { accent: '#ff5fa2', accent2: '#ffb3d1' },
        ice: { accent: '#38c7d6', accent2: '#b4f5ff' },
        gold: { accent: '#e5a925', accent2: '#ffd97a' },
        violet: { accent: '#9b6bff', accent2: '#d0b8ff' },
        mono: { accent: '#bdbdbd', accent2: '#ffffff' }
    };
    const FONTS = ['Inter', 'Rajdhani', 'Poppins', 'Montserrat', 'JetBrains Mono', 'Orbitron', 'Oswald', 'Press Start 2P', 'Comic Neue'];
    const DEFAULT = {
        theme: 'rust', ...THEMES.rust, rainbow: false,
        bg: null, bgUrl: '', dim: 0.55, blur: 0,
        opacity: 1, glass: 12, glow: 1, radius: 6,
        font: 'Inter', heading: 'Rajdhani'
    };
    const BASE = { bg: [11, 11, 12], 'bg-2': [17, 17, 19], panel: [20, 20, 22], 'panel-2': [27, 27, 30], 'panel-3': [35, 35, 39] };

    let A = { ...DEFAULT };
    let rainbowTimer = null;
    const root = document.documentElement;
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const loadedFonts = new Set(['Inter', 'Rajdhani']);

    function loadFont(name) {
        if (loadedFonts.has(name) || !FONTS.includes(name)) return;
        loadedFonts.add(name);
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;600;700&display=swap`;
        document.head.appendChild(l);
    }

    function setAccent(a1, a2) {
        const [r, g, b] = rgb(a1);
        root.style.setProperty('--accent', a1);
        root.style.setProperty('--accent-2', a2);
        root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, ${Math.min(1, 0.35 * A.glow).toFixed(2)})`);
    }

    function hsl2hex(h, s, l) {
        const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function background() {
        let layer = document.getElementById('app-bg');
        const src = A.bg === 'file' ? `/api/appearance/background?v=${A.bgVersion || 0}` : A.bg === 'url' && /^https:\/\//i.test(A.bgUrl) ? A.bgUrl : null;
        document.body.classList.toggle('has-bg', !!src);
        if (!src) { layer?.remove(); return; }
        if (!layer) { layer = document.createElement('div'); layer.id = 'app-bg'; document.body.prepend(layer); }
        const video = A.bgKind === 'video' || /\.(mp4|webm)(\?|$)/i.test(src);
        const cur = layer.firstElementChild;
        if (!cur || cur.dataset.src !== src) {
            const el = document.createElement(video ? 'video' : 'img');
            if (video) Object.assign(el, { autoplay: true, loop: true, muted: true, playsInline: true });
            el.src = src;
            el.dataset.src = src;
            layer.replaceChildren(el);
        }
        root.style.setProperty('--bg-dim', A.dim);
        root.style.setProperty('--bg-blur', `${A.blur}px`);
    }

    function apply() {
        for (const [k, [r, g, b]] of Object.entries(BASE)) {
            const alpha = k.startsWith('panel-') ? Math.min(1, A.opacity + 0.1) : A.opacity;
            root.style.setProperty(`--${k}`, alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`);
        }
        root.style.setProperty('--glass', `${A.opacity < 1 ? A.glass : 0}px`);
        root.style.setProperty('--radius', `${A.radius}px`);
        loadFont(A.font); loadFont(A.heading);
        root.style.setProperty('--font', `"${A.font}", "Segoe UI", system-ui, sans-serif`);
        root.style.setProperty('--display', `"${A.heading}", "${A.font}", sans-serif`);
        setAccent(A.accent, A.accent2);
        clearInterval(rainbowTimer);
        if (A.rainbow) {
            let h = 0;
            rainbowTimer = setInterval(() => { h = (h + 2) % 360; setAccent(hsl2hex(h, 0.85, 0.55), hsl2hex((h + 40) % 360, 0.9, 0.65)); }, 60);
        }
        background();
    }

    let saveTimer = null;
    const save = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => fetch('/api/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(A) }), 300);
    };
    const set = patch => { A = { ...A, ...patch }; apply(); save(); fill(); };

    const q = s => document.querySelector(s);
    const SLIDERS = {
        dim: v => `${Math.round(v * 100)}%`, blur: v => `${v}px`, opacity: v => `${Math.round(v * 100)}%`,
        glass: v => `${v}px`, glow: v => `${Math.round(v * 100)}%`, radius: v => `${v}px`
    };

    function fill() {
        if (!q('#ap-themes')) return;
        for (const b of q('#ap-themes').children) b.classList.toggle('active', b.dataset.theme === A.theme && !A.rainbow);
        q('#ap-accent').value = A.accent; q('#ap-accent2').value = A.accent2; q('#ap-rainbow').checked = A.rainbow;
        q('#ap-font').value = A.font; q('#ap-heading').value = A.heading;
        q('#ap-bg-url').value = A.bgUrl || '';
        q('#ap-bg-status').textContent = A.bg === 'file' ? `Using your ${A.bgKind || 'image'}` : A.bg === 'url' ? 'Using the link' : 'No background';
        for (const k in SLIDERS) { q(`#ap-${k}`).value = A[k]; q(`#ap-${k}-v`).textContent = SLIDERS[k](A[k]); }
    }

    function wire() {
        if (!q('#ap-themes')) return;
        q('#ap-themes').innerHTML = Object.entries(THEMES).map(([k, t]) =>
            `<button data-theme="${k}" title="${k}"><i style="background:linear-gradient(135deg, ${t.accent}, ${t.accent2})"></i>${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
        for (const b of q('#ap-themes').children) b.onclick = () => set({ theme: b.dataset.theme, ...THEMES[b.dataset.theme], rainbow: false });
        for (const id of ['#ap-font', '#ap-heading']) q(id).innerHTML = FONTS.map(f => `<option>${f}</option>`).join('');
        q('#ap-accent').oninput = e => set({ accent: e.target.value, theme: 'custom', rainbow: false });
        q('#ap-accent2').oninput = e => set({ accent2: e.target.value, theme: 'custom', rainbow: false });
        q('#ap-rainbow').onchange = e => set({ rainbow: e.target.checked });
        q('#ap-font').onchange = e => set({ font: e.target.value });
        q('#ap-heading').onchange = e => set({ heading: e.target.value });
        for (const k in SLIDERS) q(`#ap-${k}`).oninput = e => set({ [k]: Number(e.target.value) });
        q('#ap-bg-file').onchange = async e => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            q('#ap-bg-status').textContent = 'Uploading…';
            const r = await fetch('/api/appearance/background', { method: 'POST', headers: { 'Content-Type': f.type }, body: f }).then(r => r.json()).catch(() => ({ error: 'Upload failed' }));
            if (r.error) { q('#ap-bg-status').textContent = r.error; return; }
            set({ bg: 'file', bgKind: r.kind, bgVersion: Date.now(), opacity: A.opacity < 1 ? A.opacity : 0.75 });
        };
        q('#ap-bg-url').onchange = e => {
            const url = e.target.value.trim();
            if (url && !/^https:\/\//i.test(url)) { q('#ap-bg-status').textContent = 'Use an https:// link to an image, GIF or MP4/WebM video'; return; }
            set(url ? { bg: 'url', bgUrl: url, bgKind: /\.(mp4|webm)(\?|$)/i.test(url) ? 'video' : 'image', opacity: A.opacity < 1 ? A.opacity : 0.75 } : { bg: null, bgUrl: '' });
        };
        q('#ap-bg-clear').onclick = async () => { if (A.bg === 'file') await fetch('/api/appearance/background', { method: 'DELETE' }); set({ bg: null, bgUrl: '', opacity: 1 }); };
        q('#ap-reset').onclick = async () => { if (A.bg === 'file') await fetch('/api/appearance/background', { method: 'DELETE' }); A = { ...DEFAULT }; apply(); save(); fill(); };
        fill();
    }

    Promise.all([window.pro.ready, fetch('/api/appearance').then(r => r.json())]).then(([l, saved]) => { if (!l.pro) return; A = { ...DEFAULT, ...saved }; apply(); fill(); }).catch(() => {});
    document.addEventListener('DOMContentLoaded', wire);
    if (document.readyState !== 'loading') wire();
})();
