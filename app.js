/* LIFEVEST — shared client script
 *
 * Handles:
 *   - mobile hamburger toggle
 *   - ASMR sound effects (Web Audio API, no audio files)
 *   - Finn the Whale wisdom modal
 *
 * Sounds respect prefers-reduced-motion → muted by default for those users.
 */

(function () {
  'use strict';

  // ── Mobile nav ─────────────────────────────────────────
  const toggle = document.querySelector('.navbar-toggle');
  const links = document.querySelector('.navbar-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      sfx.bubble();
    });
    // close menu when a link is clicked (better UX on mobile)
    links.addEventListener('click', function (e) {
      if (e.target.closest('.nav-btn') && links.classList.contains('open')) {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── ASMR sounds (Web Audio API, procedural) ────────────
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ctx = null;
  function getCtx() {
    if (reduceMotion) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    return ctx;
  }
  function tone(freq, dur, type, gain) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain || 0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
    return { osc: osc, gain: g, t0: t0 };
  }
  const sfx = {
    wave: function () {
      const c = getCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(220, t0);
      o.frequency.exponentialRampToValueAtTime(110, t0 + 0.5);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.5);
    },
    bubble: function () { tone(720, 0.08, 'sine', 0.05); },
    droplet: function () { tone(900, 0.05, 'triangle', 0.04); },
    success: function () {
      const c = getCtx();
      if (!c) return;
      const t0 = c.currentTime;
      [523.25, 659.25, 783.99].forEach(function (f, i) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t0 + i * 0.1);
        g.gain.setValueAtTime(0, t0 + i * 0.1);
        g.gain.linearRampToValueAtTime(0.06, t0 + i * 0.1 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.1 + 0.4);
        o.connect(g).connect(c.destination);
        o.start(t0 + i * 0.1);
        o.stop(t0 + i * 0.1 + 0.4);
      });
    },
    whale: function () {
      const c = getCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t0);
      o.frequency.exponentialRampToValueAtTime(80, t0 + 0.7);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.07, t0 + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.8);
    },
  };
  // expose for inline page scripts
  window.lvSfx = sfx;

  // wave on nav clicks
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a.nav-btn');
    if (a) sfx.wave();
  }, true);

  // bubble on glassy buttons
  document.addEventListener('click', function (e) {
    const b = e.target.closest('.btn');
    if (b) sfx.bubble();
  }, true);

  // ── Finn the Whale wisdom modal ────────────────────────
  const finn = document.querySelector('[data-finn]');
  const modal = document.querySelector('[data-finn-modal]');
  if (finn && modal) {
    const wisdom = [
      { text: 'The plans of the diligent lead surely to plenty, but those of everyone who is hasty, surely to poverty.', cite: 'Proverbs 21:5' },
      { text: 'Commit to the Lord whatever you do, and he will establish your plans.', cite: 'Proverbs 16:3' },
      { text: 'Dishonest money dwindles away, but whoever gathers money little by little makes it grow.', cite: 'Proverbs 13:11' },
      { text: 'The rich rule over the poor, and the borrower is slave to the lender.', cite: 'Proverbs 22:7' },
      { text: 'For where your treasure is, there your heart will be also.', cite: 'Matthew 6:21' },
      { text: 'Honour the Lord with thy substance, and with the firstfruits of all thine increase.', cite: 'Proverbs 3:9' },
      { text: 'Do not save what is left after spending; spend what is left after saving.', cite: 'Warren Buffett' },
      { text: 'An investment in knowledge pays the best interest.', cite: 'Benjamin Franklin' },
      { text: 'It’s not how much money you make, but how much money you keep.', cite: 'Robert Kiyosaki' },
      { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', cite: 'Chinese proverb' },
    ];
    const blockquote = modal.querySelector('blockquote');
    const cite = modal.querySelector('cite');
    const close = modal.querySelector('.modal-close');

    function openWisdom() {
      const pick = wisdom[Math.floor(Math.random() * wisdom.length)];
      blockquote.textContent = '“' + pick.text + '”';
      cite.textContent = '— ' + pick.cite;
      modal.classList.add('open');
      sfx.whale();
    }
    function closeWisdom() {
      modal.classList.remove('open');
    }
    finn.addEventListener('click', openWisdom);
    finn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWisdom(); }
    });
    if (close) close.addEventListener('click', closeWisdom);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeWisdom(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeWisdom();
    });
  }
})();
