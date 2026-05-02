'use strict';

// Typed rotating tagline — homepage only
(function () {
  const el = document.getElementById('hero-typed');
  if (!el) return;
  const lines = [
    'We find the holes before the bad guys do.',
    'Your digital fortress — architected.',
    'Security-first. Always.',
    'Built fast. Built right. Built to last.',
    'Because your website should outlast your enemies.',
  ];
  let li = 0, ci = 0, deleting = false;
  function tick() {
    const line = lines[li];
    if (!deleting) {
      ci++;
      el.textContent = line.slice(0, ci);
      if (ci === line.length) { deleting = true; return setTimeout(tick, 2400); }
      return setTimeout(tick, 50);
    }
    ci--;
    el.textContent = line.slice(0, ci);
    if (ci === 0) { deleting = false; li = (li + 1) % lines.length; return setTimeout(tick, 360); }
    setTimeout(tick, 24);
  }
  setTimeout(tick, 900);
})();
