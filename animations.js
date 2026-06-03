(function () {
    'use strict';

    // ── 1. INJECT RUNTIME STYLES ─────────────────────────────────────────────
    document.head.insertAdjacentHTML('beforeend', `<style>
        .cursor-glow {
            position: fixed;
            top: -200px; left: -200px;
            width: 400px; height: 400px;
            border-radius: 50%;
            background: radial-gradient(circle,
                rgba(124,111,255,0.065) 0%,
                rgba(124,111,255,0.02)  45%,
                transparent 70%
            );
            pointer-events: none;
            z-index: 6;
            will-change: transform;
            transition: background 0.7s ease;
        }
        body:has(#star-mode:checked) .cursor-glow {
            background: radial-gradient(circle,
                rgba(0,255,157,0.055) 0%,
                rgba(0,255,157,0.015) 45%,
                transparent 70%
            );
        }
        @keyframes pstatReveal {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0);    }
        }
        .pstat-anim {
            animation: pstatReveal 0.48s cubic-bezier(0.34,1.56,0.64,1) backwards;
        }
    </style>`);

    // ── 2. CANVAS LAYERS ─────────────────────────────────────────────────────
    // fx: foreground effects — shooting stars, solar wind (z-index 4)
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:4;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // bg: procedural starfield behind the solar system (z-index 2)
    const bgCanvas = document.createElement('canvas');
    bgCanvas.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;';
    document.body.appendChild(bgCanvas);
    const bgCtx = bgCanvas.getContext('2d');

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let W = innerWidth, H = innerHeight;
    function resize() {
        W = innerWidth; H = innerHeight;
        canvas.width = W; canvas.height = H;
        bgCanvas.width = W * dpr; bgCanvas.height = H * dpr;
        bgCanvas.style.width = W + 'px'; bgCanvas.style.height = H + 'px';
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);  // draw in CSS px, render at device resolution
    }
    resize();
    window.addEventListener('resize', resize);

    // ── 2b. PROCEDURAL STARFIELD ──────────────────────────────────────────────
    // Soft colored star sprites are pre-rendered once, then blitted per frame —
    // far cheaper than a radial-gradient per star, so hundreds stay smooth.
    const STAR_COLORS = [
        [255, 255, 255], [255, 255, 255],   // white (most common)
        [202, 218, 255], [180, 205, 255],   // blue-white
        [255, 232, 205], [255, 208, 165],   // warm
    ];

    function makeStarSprite([r, g, b]) {
        const c = document.createElement('canvas');
        const S = 64; c.width = c.height = S;
        const x = c.getContext('2d');
        const grd = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        grd.addColorStop(0,    `rgba(${r},${g},${b},1)`);
        grd.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`);
        grd.addColorStop(1,    `rgba(${r},${g},${b},0)`);
        x.fillStyle = grd;
        x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.fill();
        return c;
    }
    const sprites = STAR_COLORS.map(makeStarSprite);

    // Cross-shaped diffraction flare — only the brightest stars wear it
    const spikeSprite = (() => {
        const c = document.createElement('canvas');
        const S = 128; c.width = c.height = S; const m = S / 2;
        const x = c.getContext('2d');
        for (const vertical of [false, true]) {
            const grd = vertical
                ? x.createLinearGradient(m, 0, m, S)
                : x.createLinearGradient(0, m, S, m);
            grd.addColorStop(0,   'rgba(255,255,255,0)');
            grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
            grd.addColorStop(1,   'rgba(255,255,255,0)');
            x.fillStyle = grd;
            if (vertical) x.fillRect(m - 1.5, 0, 3, S);
            else          x.fillRect(0, m - 1.5, S, 3);
        }
        return c;
    })();

    const stars = [];
    function makeStar(extra) {
        const z = Math.random();  // depth: 0 far → 1 near (drives size + parallax)
        // Extra stars (Star Mode) skew smaller & fainter → a dense Milky-Way sprinkle
        const sizeMul = extra ? 0.4 + Math.random() * 0.55 : 0.7 + Math.random() * 0.7;
        return {
            x: Math.random(), y: Math.random(), z,
            r: (0.45 + z * 1.25) * sizeMul,
            si: (Math.random() * sprites.length) | 0,
            base: extra ? 0.3 + Math.random() * 0.45 : 0.4 + Math.random() * 0.5,
            tw: Math.random() * Math.PI * 2,
            tws: 0.5 + Math.random() * 1.8,
            twAmp: reduceMotion ? 0.08 : 0.3 + Math.random() * 0.35,
            spike: Math.random() < (extra ? 0.02 : 0.05),
            extra,
        };
    }
    for (let i = 0; i < 300; i++)  stars.push(makeStar(false));  // always visible
    for (let i = 0; i < 1100; i++) stars.push(makeStar(true));   // dense field for Star Mode

    // Star-mode boost — a 0→1 value lerped each frame for a fluid transition
    const starModeInput = document.getElementById('star-mode');
    let boostTarget = starModeInput && starModeInput.checked ? 1 : 0;
    let boost = boostTarget;
    if (starModeInput)
        starModeInput.addEventListener('change', () => { boostTarget = starModeInput.checked ? 1 : 0; });

    function drawStarfield(now) {
        bgCtx.clearRect(0, 0, W, H);
        const t = now * 0.001;
        for (const s of stars) {
            const present = s.extra ? boost : 1;
            if (present < 0.02) continue;
            const twinkle = (1 - s.twAmp) + s.twAmp * (0.5 + 0.5 * Math.sin(t * s.tws + s.tw));
            let a = s.base * twinkle * present * (0.7 + boost * 0.7);
            if (a < 0.02) continue;
            if (a > 1) a = 1;

            const depth = 6 + s.z * 30;                 // nearer stars parallax more
            const x = s.x * W + pcx * depth;
            const y = s.y * H + pcy * depth;
            const d = s.r * 5.5 * (1 + boost * 0.45);

            bgCtx.globalAlpha = a;
            bgCtx.drawImage(sprites[s.si], x - d / 2, y - d / 2, d, d);
            if (s.spike) {
                const sd = d * (2.6 + boost * 2.4);
                bgCtx.globalAlpha = a * (0.35 + boost * 0.6);
                bgCtx.drawImage(spikeSprite, x - sd / 2, y - sd / 2, sd, sd);
            }
        }
        bgCtx.globalAlpha = 1;
    }

    // ── 3. PARALLAX ──────────────────────────────────────────────────────────
    const bgLayers = [
        { el: document.querySelector('.void-bg'),       s: 2  },
        { el: document.querySelector('.nebula-layer'),  s: 6  },
        { el: document.querySelector('.stars-layer-1'), s: 12 },
        { el: document.querySelector('.stars-layer-2'), s: 20 },
        { el: document.querySelector('.star-glows'),    s: 28 },
    ].filter(d => d.el);

    let ptx = 0, pty = 0;  // parallax target (normalized -0.5 → 0.5)
    let pcx = 0, pcy = 0;  // parallax current (lerped)

    // ── 4. CURSOR GLOW ───────────────────────────────────────────────────────
    const cursorGlow = document.createElement('div');
    cursorGlow.className = 'cursor-glow';
    document.body.appendChild(cursorGlow);

    let cgTargetX = -200, cgTargetY = -200;
    let cgCurX    = -200, cgCurY    = -200;

    document.addEventListener('mousemove', e => {
        ptx = e.clientX / W - 0.5;
        pty = e.clientY / H - 0.5;
        cgTargetX = e.clientX;
        cgTargetY = e.clientY;
    });

    // ── 5. CANVAS SHOOTING STARS ─────────────────────────────────────────────
    const sStar = [];

    function newStar() {
        const fromTop = Math.random() > 0.28;
        return {
            x:    fromTop ? W * (Math.random() * 1.3 - 0.15) : -15,
            y:    fromTop ? -15 : H * Math.random() * 0.65,
            ang:  (10 + Math.random() * 30) * (Math.PI / 180),
            spd:  6 + Math.random() * 12,
            len:  80 + Math.random() * 150,
            op:   0,
            mop:  0.4 + Math.random() * 0.6,
            th:   0.4 + Math.random() * 1.3,
            rise: true,
        };
    }

    // Staggered initial spawns, then random recurring schedule
    [700, 3300, 6600].forEach(d => setTimeout(() => sStar.push(newStar()), d));
    (function scheduleStar() {
        const delay = (2000 + Math.random() * 9000) * (1 - boost * 0.55);  // more frequent in Star Mode
        setTimeout(() => { sStar.push(newStar()); scheduleStar(); }, delay);
    })();

    // ── 6. SOLAR WIND PARTICLES ───────────────────────────────────────────────
    const sWind = [];
    const sunEl = document.querySelector('.sun');
    let pTick   = 0;

    function newWind(sx, sy) {
        const a = Math.random() * Math.PI * 2;
        const warm = Math.random() > 0.5;
        return {
            x: sx + (Math.random() - 0.5) * 24,
            y: sy + (Math.random() - 0.5) * 24,
            vx: Math.cos(a) * (0.25 + Math.random() * 0.9),
            vy: Math.sin(a) * (0.25 + Math.random() * 0.9),
            sz: 0.35 + Math.random() * 1.1,
            life: 0,
            mLife: 70 + Math.random() * 110,
            mOp: 0.07 + Math.random() * 0.2,
            r: 255, g: warm ? 175 : 215, b: warm ? 55 : 95,
        };
    }

    // ── 7. PANEL STAT REVEAL ANIMATION ───────────────────────────────────────
    function revealStats(inputId) {
        const planetId = inputId.replace('focus-', '');
        const card = document.querySelector(
            planetId === 'none' ? '.panel-system' : `.panel-${planetId}`
        );
        if (!card) return;
        card.querySelectorAll('.pstat').forEach((el, i) => {
            el.classList.remove('pstat-anim');
            void el.offsetWidth;  // force reflow to restart CSS animation
            el.classList.add('pstat-anim');
            el.style.animationDelay = `${0.05 + i * 0.09}s`;
        });
    }

    document.querySelectorAll('[name="planet-focus"]').forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) setTimeout(() => revealStats(input.id), 140);
        });
    });

    // Trigger on initial load
    const initialFocus = document.querySelector('[name="planet-focus"]:checked');
    if (initialFocus) setTimeout(() => revealStats(initialFocus.id), 400);

    // ── 8. KEYBOARD NAVIGATION ────────────────────────────────────────────────
    const keyMap = {
        Escape: 'focus-none',
        Digit0: 'focus-none',
        Digit1: 'focus-mercury',
        Digit2: 'focus-venus',
        Digit3: 'focus-earth',
        Digit4: 'focus-mars',
        Digit5: 'focus-jupiter',
        Digit6: 'focus-saturn',
    };

    document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        const id = keyMap[e.code] || keyMap[e.key];
        if (!id) return;
        const el = document.getElementById(id);
        if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
    });

    // ── 9. UPDATE BOTTOM BAR ──────────────────────────────────────────────────
    document.querySelectorAll('.bar-item').forEach(item => {
        const label = item.querySelector('.bar-label');
        const val   = item.querySelector('.bar-val');
        if (label && val && val.textContent.trim() === '0%') {
            label.textContent = 'JS Animações';
            val.textContent   = '✦ Ativo';
        }
    });

    // ── 10. MAIN ANIMATION LOOP ───────────────────────────────────────────────
    function loop(now) {
        now = now || performance.now();
        requestAnimationFrame(loop);
        ctx.clearRect(0, 0, W, H);

        // Star-mode boost — fluid ramp toward target
        boost += (boostTarget - boost) * 0.045;

        // Parallax — smooth lerp toward mouse target
        pcx += (ptx - pcx) * 0.05;
        pcy += (pty - pcy) * 0.05;
        for (const { el, s } of bgLayers)
            el.style.transform = `translate(${pcx * s}px, ${pcy * s}px)`;

        // Procedural starfield — depth parallax + realistic twinkle
        drawStarfield(now);

        // Cursor glow — faster lerp for responsive feel
        cgCurX += (cgTargetX - cgCurX) * 0.12;
        cgCurY += (cgTargetY - cgCurY) * 0.12;
        cursorGlow.style.transform = `translate(${cgCurX}px, ${cgCurY}px)`;

        // ── Shooting stars ───────────────────────────────────────────────────
        for (let i = sStar.length - 1; i >= 0; i--) {
            const s = sStar[i];
            s.x += Math.cos(s.ang) * s.spd;
            s.y += Math.sin(s.ang) * s.spd;
            s.op = s.rise
                ? Math.min(s.mop, s.op + 0.08)
                : Math.max(0, s.op - 0.02);
            if (s.rise && s.op >= s.mop) s.rise = false;

            if ((!s.rise && s.op <= 0) || s.x > W + s.len || s.y > H + s.len) {
                sStar.splice(i, 1);
                continue;
            }

            const tx2 = s.x - Math.cos(s.ang) * s.len;
            const ty2 = s.y - Math.sin(s.ang) * s.len;
            const g   = ctx.createLinearGradient(tx2, ty2, s.x, s.y);
            g.addColorStop(0,   `rgba(255,255,255,0)`);
            g.addColorStop(0.5, `rgba(210,228,255,${s.op * 0.3})`);
            g.addColorStop(1,   `rgba(255,255,255,${s.op})`);

            ctx.save();
            ctx.strokeStyle = g;
            ctx.lineWidth   = s.th;
            ctx.shadowBlur  = 12;
            ctx.shadowColor = `rgba(170,200,255,${s.op})`;
            ctx.beginPath();
            ctx.moveTo(tx2, ty2);
            ctx.lineTo(s.x, s.y);
            ctx.stroke();
            // Bright head dot
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.th * 2.5, 0, Math.PI * 2);
            ctx.fillStyle  = `rgba(255,255,255,${s.op})`;
            ctx.shadowBlur = 18;
            ctx.fill();
            ctx.restore();
        }

        // ── Solar wind particles ─────────────────────────────────────────────
        if (sunEl) {
            const r   = sunEl.getBoundingClientRect();
            const sx  = r.left + r.width  / 2;
            const sy  = r.top  + r.height / 2;
            const vis = sx > -60 && sx < W + 60 && sy > -60 && sy < H + 60;

            if (vis && sWind.length < 55 && ++pTick >= 4) {
                pTick = 0;
                sWind.push(newWind(sx, sy));
            }

            for (let i = sWind.length - 1; i >= 0; i--) {
                const p  = sWind[i];
                p.x += p.vx; p.y += p.vy; p.life++;
                const op = p.mOp * Math.sin((p.life / p.mLife) * Math.PI);
                if (p.life >= p.mLife) { sWind.splice(i, 1); continue; }
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${op})`;
                ctx.fill();
            }
        }
    }

    loop();
})();
