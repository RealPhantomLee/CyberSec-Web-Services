'use strict';

// ─── GLOBAL HEX CANVAS (fixed behind all pages) ───────────────────────────────
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx  = canvas.getContext('2d');
  const LIME = '226,232,0';
  const SIZE = 30;
  let mouse  = { x: -999, y: -999 };
  let hexes  = [];
  let scanY  = 0;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    buildGrid();
  }

  function buildGrid() {
    hexes = [];
    const cw = SIZE * 1.5;
    const rh = SIZE * Math.sqrt(3);
    const cols = Math.ceil(canvas.width  / cw) + 2;
    const rows = Math.ceil(canvas.height / rh) + 2;
    for (let c = -1; c < cols; c++)
      for (let r = -1; r < rows; r++)
        hexes.push({ x: c * cw, y: r * rh + (c % 2 ? rh / 2 : 0), pulse: 0, live: false });
  }

  function drawHex(x, y, glow, pulse) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a  = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + (SIZE - 1) * Math.cos(a);
      const py = y + (SIZE - 1) * Math.sin(a);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    const alpha = Math.min(0.04 + glow * 0.22 + pulse * 0.38, 1);
    ctx.strokeStyle = `rgba(${LIME},${alpha})`;
    ctx.lineWidth   = 0.35 + glow * 1.55 + pulse * 1.25;
    ctx.stroke();
    if (glow > 0.07 || pulse > 0.08) {
      ctx.fillStyle = `rgba(${LIME},${glow * 0.05 + pulse * 0.07})`;
      ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scanning sweep line
    scanY = (scanY + 0.3) % canvas.height;
    const sg = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 8);
    sg.addColorStop(0,   `rgba(${LIME},0)`);
    sg.addColorStop(0.68, `rgba(${LIME},0.03)`);
    sg.addColorStop(1,   `rgba(${LIME},0.065)`);
    ctx.fillStyle = sg;
    ctx.fillRect(0, scanY - 60, canvas.width, 68);

    for (const h of hexes) {
      const glow = Math.max(0, 1 - Math.hypot(h.x - mouse.x, h.y - mouse.y) / 195);
      if (!h.live && Math.random() < 0.00022) { h.live = true; h.pulse = 1; }
      if (h.live) { h.pulse -= 0.016; if (h.pulse <= 0) { h.pulse = 0; h.live = false; } }
      drawHex(h.x, h.y, glow, h.pulse);
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  resize();
  draw();
})();


// ─── PAGE VISIT TRACKING ─────────────────────────────────────────────────────
(function () {
  try {
    const today = new Date().toISOString().split('T')[0];
    const page  = window.location.pathname.split('/').pop().replace(/\.html$/, '') || 'home';
    const visits = JSON.parse(localStorage.getItem('pcs_visits') || '{}');
    if (!visits[today]) visits[today] = {};
    visits[today][page] = (visits[today][page] || 0) + 1;
    const keys = Object.keys(visits).sort();
    if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete visits[k]);
    localStorage.setItem('pcs_visits', JSON.stringify(visits));
    const total = JSON.parse(localStorage.getItem('pcs_total') || '{}');
    total[page] = (total[page] || 0) + 1;
    total['__all'] = (total['__all'] || 0) + 1;
    localStorage.setItem('pcs_total', JSON.stringify(total));
    const lastSeen = parseInt(localStorage.getItem('pcs_last') || '0', 10);
    const now = Date.now();
    if (now - lastSeen > 1800000) {
      const sessions = JSON.parse(localStorage.getItem('pcs_sessions') || '{}');
      sessions[today] = (sessions[today] || 0) + 1;
      localStorage.setItem('pcs_sessions', JSON.stringify(sessions));
    }
    localStorage.setItem('pcs_last', String(now));
  } catch (_) {}
})();


// ─── CUSTOM CURSOR (performance-optimised, transform only) ───────────────────
(function () {
  const ring = document.getElementById('phantom-cursor');
  if (!ring) return;

  const DOTS = 8;
  const dots = [];
  const hw   = 11; // half of 22px cursor width

  for (let i = 0; i < DOTS; i++) {
    const d  = document.createElement('div');
    d.className = 'cursor-dot';
    const s  = 1 - (i / DOTS) * 0.75;
    const op = (1 - i / DOTS) * 0.5;
    const sz = Math.round(7 * s);
    d.style.cssText = `width:${sz}px;height:${sz}px;opacity:${op.toFixed(2)};`;
    document.body.appendChild(d);
    dots.push({ el: d, x: -200, y: -200, hw: sz / 2 });
  }

  let mx = -200, my = -200;

  ring.style.cssText += 'top:0;left:0;will-change:transform;';
  ring.style.transform = `translate(-200px,-200px)`;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    ring.style.transform = `translate(${mx - hw}px,${my - hw}px)`;
  }, { passive: true });

  // Event delegation — one listener, no per-element attachment
  document.addEventListener('mouseover', e => {
    if (e.target.closest('a,button,.service-card,.product-card,.blog-card,.admin-nav-item,.qa-btn,.btn-sm'))
      ring.classList.add('hovering');
    else
      ring.classList.remove('hovering');
  }, { passive: true });

  document.addEventListener('mousedown', () => ring.classList.add('clicking'),  { passive: true });
  document.addEventListener('mouseup',   () => ring.classList.remove('clicking'), { passive: true });

  function tick() {
    let px = mx, py = my;
    for (const dot of dots) {
      dot.x += (px - dot.x) * 0.38;
      dot.y += (py - dot.y) * 0.38;
      dot.el.style.transform = `translate(${dot.x - dot.hw}px,${dot.y - dot.hw}px)`;
      px = dot.x; py = dot.y;
    }
    requestAnimationFrame(tick);
  }
  tick();
})();


// ─── SCROLL REVEAL ────────────────────────────────────────────────────────────
(function () {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.08 });
  els.forEach(el => obs.observe(el));
})();


// ─── MOBILE HAMBURGER MENU ────────────────────────────────────────────────────
(function () {
  const btn   = document.getElementById('nav-hamburger');
  const links = document.getElementById('nav-links');
  if (!btn || !links) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = links.classList.toggle('nav-open');
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  });

  links.addEventListener('click', e => {
    if (e.target.tagName === 'A') {
      links.classList.remove('nav-open');
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('header')) {
      links.classList.remove('nav-open');
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  }, { passive: true });
})();


// ─── CART BADGE ───────────────────────────────────────────────────────────────
(function () {
  function syncBadge() {
    const count = JSON.parse(localStorage.getItem('cart') || '[]').length;
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  syncBadge();
  window.addEventListener('storage', syncBadge);
  document.addEventListener('cartUpdated', syncBadge);
})();
