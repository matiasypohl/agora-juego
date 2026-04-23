/* ═══════════════════════════════════════════════════════════
   ÁGORA — Landing Page Animations
   ─ initParticles  : Canvas con partículas flotantes
   ─ initParallax   : Efecto parallax al hacer scroll
   ─ initScrollReveal: Fade-in de elementos al entrar al viewport
   ─ initNavbar     : Navbar con blur al hacer scroll
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── Partículas Canvas ────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReduced) return;

  const CONFIG = {
    count:       isMobile ? 30 : 55,
    maxDist:     isMobile ? 100 : 130,
    minR:        1.0,
    maxR:        2.8,
    speed:       0.32,
    colors:      ['#7c3aed', '#9d6eff', '#a78bfa', '#fcd34d', '#5b21b6']
  };

  let particles = [];
  let animId    = null;
  let W = 0, H = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = canvas.width  = Math.round(rect.width);
    H = canvas.height = Math.round(rect.height);
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function mkParticle() {
    return {
      x:  Math.random() * W,
      y:  Math.random() * H,
      vx: (Math.random() - 0.5) * CONFIG.speed * 2,
      vy: (Math.random() - 0.5) * CONFIG.speed * 2,
      r:  CONFIG.minR + Math.random() * (CONFIG.maxR - CONFIG.minR),
      color:   CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)],
      opacity: 0.35 + Math.random() * 0.55
    };
  }

  function init() {
    particles = Array.from({ length: CONFIG.count }, mkParticle);
  }

  function update() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) { p.vx *= -1; p.x = Math.max(0, Math.min(W, p.x)); }
      if (p.y < 0 || p.y > H) { p.vy *= -1; p.y = Math.max(0, Math.min(H, p.y)); }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Líneas de conexión entre partículas cercanas
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx   = particles[i].x - particles[j].x;
        const dy   = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONFIG.maxDist) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124,58,237,${(1 - dist / CONFIG.maxDist) * 0.32})`;
          ctx.lineWidth   = 0.9;
          ctx.stroke();
        }
      }
    }

    // Puntos
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(p.color, p.opacity);
      ctx.fill();
    }
  }

  function loop() {
    update();
    draw();
    animId = requestAnimationFrame(loop);
  }

  function start() { if (!animId) loop(); }
  function stop()  { cancelAnimationFrame(animId); animId = null; }

  // Pausar cuando el hero no es visible (ahorro de CPU)
  const heroSection = document.getElementById('hero');
  if (heroSection && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries[0].isIntersecting ? start() : stop();
    }, { threshold: 0 }).observe(heroSection);
  } else {
    start();
  }

  // Resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      for (const p of particles) {
        p.x = Math.min(p.x, W);
        p.y = Math.min(p.y, H);
      }
    }, 200);
  });

  resize();
  init();
})();


// ─── Parallax ─────────────────────────────────────────────
(function initParallax() {
  const layers = document.querySelectorAll('[data-parallax-speed]');
  if (!layers.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Desactivar en mobile (rendimiento)
  if (window.matchMedia('(max-width: 600px)').matches) return;

  let ticking = false;

  function applyParallax() {
    const sy = window.scrollY;
    layers.forEach(el => {
      const speed = parseFloat(el.dataset.parallaxSpeed) || 0;
      el.style.transform = `translateY(${(sy * speed).toFixed(2)}px)`;
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(applyParallax);
      ticking = true;
    }
  }, { passive: true });
})();


// ─── Scroll Reveal ────────────────────────────────────────
(function initScrollReveal() {
  const elements = document.querySelectorAll('.reveal-on-scroll');
  if (!elements.length) return;

  // Aplicar delays desde data-delay
  elements.forEach(el => {
    const delay = parseInt(el.dataset.delay, 10) || 0;
    if (delay > 0) el.style.transitionDelay = delay + 'ms';
  });

  // Si el usuario prefiere sin movimiento: mostrar todo ya
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach(el => el.classList.add('is-visible'));
    return;
  }

  if (!('IntersectionObserver' in window)) {
    elements.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold:   0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  elements.forEach(el => observer.observe(el));
})();


// ─── Navbar blur al hacer scroll ──────────────────────────
(function initNavbar() {
  const nav = document.getElementById('landing-nav');
  if (!nav) return;

  const THRESHOLD = 60;

  function onScroll() {
    nav.classList.toggle('landing-nav--scrolled', window.scrollY > THRESHOLD);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // estado inicial
})();
