'use client';

import React, { useState, useEffect } from 'react';
import { Target, Award, Home, Users, TrendingUp, X, Crown, Sparkles, ChevronRight } from 'lucide-react';

const LifeVest = () => {
  const [activeTab, setActiveTab] = useState('home');
  const [currentTier, setCurrentTier] = useState('free');
  const [selectedTier, setSelectedTier] = useState('sovereign');
  const [billingCycle, setBillingCycle] = useState('annual');
  const [showPaywall, setShowPaywall] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [particles, setParticles] = useState([]);

  const dailyStreak = 7;
  const [barnaclePoints, setBarnaclePoints] = useState(1250);
  const knowledgeXP = 350;

  // Vault game
  const [currentGuess, setCurrentGuess] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [gameWon, setGameWon] = useState(false);
  const todaysWord = 'YIELD';

  // Hydration fix: only render random particles after mount (client-side)
  useEffect(() => {
    setMounted(true);
    const particleData = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      duration: Math.random() * 15 + 10,
      delay: Math.random() * 5
    }));
    setParticles(particleData);
  }, []);

  const playSound = (type) => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const sounds = {
        wave: { freq: 200, decay: 0.5, vol: 0.1 },
        bubble: { freq: 800, decay: 0.1, vol: 0.15 },
        success: { freq: 523.25, decay: 0.3, vol: 0.2 }
      };

      const s = sounds[type] || sounds.bubble;
      osc.frequency.setValueAtTime(s.freq, ctx.currentTime);
      gain.gain.setValueAtTime(s.vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + s.decay);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + s.decay);
    } catch (e) {
      // Silently fail if audio not supported
    }
  };

  const handleKeyPress = (key) => {
    playSound('bubble');
    if (key === 'BACK') {
      setCurrentGuess(currentGuess.slice(0, -1));
    } else if (key === 'ENTER') {
      if (currentGuess.length === 5) {
        const newGuesses = [...guesses, currentGuess.toUpperCase()];
        setGuesses(newGuesses);
        if (currentGuess.toUpperCase() === todaysWord) {
          setGameWon(true);
          setBarnaclePoints(barnaclePoints + 50);
          playSound('success');
        }
        setCurrentGuess('');
      }
    } else if (currentGuess.length < 5) {
      setCurrentGuess(currentGuess + key);
    }
  };

  const getTileColor = (letter, index, word) => {
    if (!word) return '';
    if (todaysWord[index] === letter) return 'correct';
    if (todaysWord.includes(letter)) return 'present';
    return 'absent';
  };

  const tiers = {
    voyager: {
      name: 'Voyager',
      icon: '⚓',
      price: { monthly: 9, annual: 89 },
      savings: 19,
      tagline: 'Start Your Journey',
      features: ['Autopilot Lite', '10 Courses', 'Basic Analytics', 'Community', '3 Strategies']
    },
    sovereign: {
      name: 'Sovereign',
      icon: '👑',
      price: { monthly: 29, annual: 299 },
      savings: 49,
      tagline: 'Master Your Wealth',
      badge: 'BEST VALUE',
      features: ['Everything in Voyager', 'AI Coach', 'Tax Harvesting', 'Portfolio X-Ray', '50+ Courses', 'Whale Alerts', '20 Strategies', '12 Calculators']
    },
    platinum: {
      name: 'Platinum',
      icon: '💎',
      price: { monthly: 79, annual: 799 },
      savings: 149,
      tagline: 'Ultimate Command',
      badge: 'PREMIUM',
      features: ['Everything in Sovereign', 'Account Manager', 'Unlimited Strategies', 'Family Plan', 'After-Hours Trading', 'Metal Card 3%', 'Airport Lounges']
    }
  };

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Space Mono', monospace;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      margin: 0;
    }

    .lv-app {
      min-height: 100vh;
      background: radial-gradient(ellipse at 20% 10%, rgba(0,245,255,0.15) 0%, transparent 50%),
                  radial-gradient(ellipse at 80% 90%, rgba(0,150,255,0.12) 0%, transparent 50%),
                  linear-gradient(180deg, #001219 0%, #000000 50%, #000814 100%);
      color: #fff;
      padding-bottom: 100px;
      position: relative;
      overflow: hidden;
      font-family: 'Space Mono', monospace;
    }

    .lv-particles {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
    }

    .lv-particle {
      position: absolute;
      width: 3px;
      height: 3px;
      background: rgba(255,255,255,0.4);
      border-radius: 50%;
      animation-name: lv-fall;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
    }

    @keyframes lv-fall {
      0% { transform: translate3d(0,-20px,0); opacity: 0; }
      10% { opacity: 0.8; }
      90% { opacity: 0.3; }
      100% { transform: translate3d(20px,100vh,0); opacity: 0; }
    }

    .lv-glass {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(60px) saturate(200%);
      -webkit-backdrop-filter: blur(60px) saturate(200%);
      border: 0.5px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 24px;
      margin-bottom: 16px;
      transition: all 0.4s cubic-bezier(0.16,1,0.3,1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
      position: relative;
    }

    .lv-glass:hover {
      transform: translate3d(0,-8px,0);
      box-shadow: 0 16px 48px rgba(0,245,255,0.2);
      border-color: rgba(0,245,255,0.3);
    }

    .lv-view {
      padding: 32px 20px;
      max-width: 680px;
      margin: 0 auto;
      position: relative;
      z-index: 10;
      animation: lv-slideIn 0.6s cubic-bezier(0.16,1,0.3,1);
    }

    @keyframes lv-slideIn {
      0% { opacity: 0; transform: translate3d(0,40px,0) scale(0.95); }
      100% { opacity: 1; transform: translate3d(0,0,0) scale(1); }
    }

    .lv-whale {
      font-size: 80px;
      text-align: center;
      margin: 24px 0;
      animation: lv-breathe 4.5s ease-in-out infinite;
      cursor: pointer;
      filter: drop-shadow(0 12px 40px rgba(0,245,255,0.4));
      transition: all 0.5s cubic-bezier(0.16,1,0.3,1);
    }

    .lv-whale:hover {
      transform: translate3d(0,-16px,0) scale(1.1);
    }

    @keyframes lv-breathe {
      0%, 100% { transform: translate3d(0,0,0) scale(1); }
      50% { transform: translate3d(0,-10px,0) scale(1.03); }
    }

    .lv-title {
      font-family: 'Orbitron', sans-serif;
      font-size: clamp(36px,7vw,56px);
      font-weight: 900;
      text-align: center;
      background: linear-gradient(135deg, #fff 0%, #00F5FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 12px;
    }

    .lv-subtitle {
      text-align: center;
      color: rgba(255,255,255,0.7);
      font-size: 16px;
      margin-bottom: 40px;
    }

    .lv-stats {
      display: grid;
      grid-template-columns: repeat(3,1fr);
      gap: 12px;
      margin-bottom: 32px;
    }

    .lv-stat {
      text-align: center;
      padding: 28px 20px;
      background: rgba(255,255,255,0.04);
      backdrop-filter: blur(40px);
      border: 0.5px solid rgba(255,255,255,0.12);
      border-radius: 20px;
      transition: all 0.4s;
      animation: lv-float 6s ease-in-out infinite;
    }

    .lv-stat:nth-child(1) { animation-delay: 0s; }
    .lv-stat:nth-child(2) { animation-delay: 0.3s; }
    .lv-stat:nth-child(3) { animation-delay: 0.6s; }

    @keyframes lv-float {
      0%, 100% { transform: translate3d(0,0,0); }
      50% { transform: translate3d(0,-10px,0); }
    }

    .lv-stat-icon { font-size: 44px; margin-bottom: 12px; }
    .lv-stat-value { font-size: 36px; font-weight: 700; font-family: 'Orbitron', sans-serif; }
    .lv-stat-label { font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; }

    .lv-banner {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 24px;
      background: linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(0,245,255,0.1) 100%);
      border: 1px solid rgba(255,215,0,0.3);
      border-radius: 24px;
      margin-bottom: 24px;
      cursor: pointer;
      backdrop-filter: blur(40px);
      transition: all 0.4s;
    }

    .lv-banner:hover { transform: translate3d(0,-6px,0); }

    .lv-wordle-grid {
      display: grid;
      gap: 8px;
      max-width: 350px;
      margin: 0 auto 32px;
    }

    .lv-wordle-row {
      display: grid;
      grid-template-columns: repeat(5,1fr);
      gap: 8px;
    }

    .lv-tile {
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 700;
      font-family: 'Orbitron', sans-serif;
      background: rgba(255,255,255,0.05);
      border: 2px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      backdrop-filter: blur(20px);
      transition: all 0.3s;
    }

    .lv-tile.correct {
      background: rgba(0,245,255,0.2);
      border-color: #00F5FF;
      box-shadow: 0 0 20px rgba(0,245,255,0.6);
      transform: scale(1.05);
    }

    .lv-tile.present {
      background: rgba(255,215,0,0.2);
      border-color: #FFD700;
      box-shadow: 0 0 20px rgba(255,215,0,0.5);
      transform: scale(1.05);
    }

    .lv-tile.absent {
      background: rgba(255,255,255,0.02);
      opacity: 0.5;
    }

    .lv-keyboard {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 500px;
      margin: 0 auto;
    }

    .lv-keyboard-row {
      display: flex;
      gap: 6px;
      justify-content: center;
    }

    .lv-key {
      min-width: 40px;
      padding: 16px 12px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      color: #fff;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      backdrop-filter: blur(20px);
      font-family: inherit;
    }

    .lv-key:hover {
      background: rgba(255,255,255,0.15);
      transform: translate3d(0,-2px,0);
    }

    .lv-key:active { transform: scale(0.95); }
    .lv-key-wide { padding: 16px 20px; font-size: 12px; }

    .lv-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(30px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3000;
      padding: 24px;
      animation: lv-fadeIn 0.3s;
      overflow-y: auto;
    }

    @keyframes lv-fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .lv-modal-content {
      background: rgba(0,18,25,0.95);
      backdrop-filter: blur(80px);
      border: 1px solid rgba(0,245,255,0.2);
      border-radius: 32px;
      padding: 48px 36px;
      max-width: 1100px;
      width: 100%;
      position: relative;
      animation: lv-slideUp 0.5s cubic-bezier(0.16,1,0.3,1);
      max-height: 90vh;
      overflow-y: auto;
    }

    @keyframes lv-slideUp {
      from { opacity: 0; transform: translate3d(0,40px,0) scale(0.95); }
      to { opacity: 1; transform: translate3d(0,0,0) scale(1); }
    }

    .lv-close {
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255,255,255,0.1);
      border: none;
      border-radius: 50%;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #fff;
      transition: all 0.3s;
    }

    .lv-close:hover {
      background: rgba(255,255,255,0.2);
      transform: rotate(90deg);
    }

    .lv-tiers {
      display: grid;
      grid-template-columns: repeat(3,1fr);
      gap: 20px;
      margin: 32px 0;
    }

    .lv-tier {
      background: rgba(255,255,255,0.04);
      border: 2px solid rgba(255,255,255,0.1);
      border-radius: 28px;
      padding: 32px 24px;
      cursor: pointer;
      transition: all 0.4s;
      position: relative;
      backdrop-filter: blur(60px);
    }

    .lv-tier:hover { transform: translate3d(0,-12px,0); }

    .lv-tier.selected {
      border-color: #00F5FF;
      background: rgba(0,245,255,0.08);
      box-shadow: 0 0 40px rgba(0,245,255,0.4);
    }

    .lv-tier-badge {
      position: absolute;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      background: #FFD700;
      color: #000;
      padding: 6px 18px;
      border-radius: 14px;
      font-size: 10px;
      font-weight: 700;
    }

    .lv-tier-icon { font-size: 56px; text-align: center; margin-bottom: 16px; }

    .lv-tier-name {
      font-family: 'Orbitron', sans-serif;
      font-size: 28px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 8px;
    }

    .lv-tier-tagline {
      text-align: center;
      font-size: 13px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 24px;
    }

    .lv-tier-price { text-align: center; margin-bottom: 12px; }
    .lv-price-big { font-size: 48px; font-weight: 900; font-family: 'Orbitron', sans-serif; }
    .lv-price-small { font-size: 16px; color: rgba(255,255,255,0.6); }

    .lv-subscribe-btn {
      background: linear-gradient(135deg, #00F5FF 0%, #00D4E0 100%);
      color: #000;
      border: none;
      border-radius: 16px;
      padding: 20px 40px;
      font-weight: 700;
      font-size: 18px;
      font-family: 'Orbitron', sans-serif;
      cursor: pointer;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-top: 32px;
      transition: all 0.3s;
    }

    .lv-subscribe-btn:hover {
      transform: translate3d(0,-4px,0) scale(1.02);
    }

    .lv-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(0,18,25,0.9);
      backdrop-filter: blur(60px);
      border-top: 0.5px solid rgba(0,245,255,0.2);
      padding: 12px 0;
      z-index: 1000;
    }

    .lv-nav-items {
      display: flex;
      justify-content: space-around;
      max-width: 680px;
      margin: 0 auto;
      padding: 0 20px;
    }

    .lv-nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      cursor: pointer;
      border-radius: 14px;
      color: rgba(255,255,255,0.4);
      transition: all 0.3s;
    }

    .lv-nav-item:active { transform: scale(0.92); }

    .lv-nav-item.active {
      color: #00F5FF;
      text-shadow: 0 0 20px rgba(0,245,255,0.8);
    }

    .lv-nav-label { font-size: 11px; font-weight: 600; }

    @media (max-width: 768px) {
      .lv-tiers { grid-template-columns: 1fr; }
      .lv-stats { grid-template-columns: 1fr; }
    }
  `;

  return (
    <div className="lv-app">
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      {/* Marine snow particles - only render after mount to avoid hydration mismatch */}
      {mounted && (
        <div className="lv-particles">
          {particles.map((p) => (
            <div
              key={p.id}
              className="lv-particle"
              style={{
                left: p.left + '%',
                animationDuration: p.duration + 's',
                animationDelay: p.delay + 's'
              }}
            />
          ))}
        </div>
      )}

      {activeTab === 'home' && (
        <div className="lv-view">
          <div className="lv-whale" onClick={() => playSound('bubble')}>
            🐋{dailyStreak >= 7 && '🎩'}
          </div>
          <h1 className="lv-title">Welcome back, Captain</h1>
          <p className="lv-subtitle">Your financial ocean is looking mighty clear today</p>

          {currentTier === 'free' && (
            <div className="lv-banner lv-glass" onClick={() => setShowPaywall(true)}>
              <Crown size={32} color="#FFD700" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '18px', color: '#FFD700', marginBottom: '6px' }}>
                  Join The Sovereign Club
                </div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
                  Unlock AI Coach, Tax Harvesting & Premium Tools
                </div>
              </div>
              <ChevronRight size={20} color="#FFD700" />
            </div>
          )}

          <div className="lv-stats">
            <div className="lv-stat lv-glass">
              <div className="lv-stat-icon">🔥</div>
              <div className="lv-stat-value">{dailyStreak}</div>
              <div className="lv-stat-label">Day Streak</div>
            </div>
            <div className="lv-stat lv-glass">
              <div className="lv-stat-icon">🐚</div>
              <div className="lv-stat-value">{barnaclePoints}</div>
              <div className="lv-stat-label">Barnacle Bucks</div>
            </div>
            <div className="lv-stat lv-glass">
              <div className="lv-stat-icon">⚡</div>
              <div className="lv-stat-value">{knowledgeXP}</div>
              <div className="lv-stat-label">Knowledge XP</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="lv-view">
          <h1 className="lv-title" style={{ fontSize: '36px' }}>The Vault</h1>
          <p className="lv-subtitle">Crack the code, earn Barnacle Bucks</p>

          <div className="lv-wordle-grid">
            {[0, 1, 2, 3, 4, 5].map((rowIdx) => (
              <div key={rowIdx} className="lv-wordle-row">
                {[0, 1, 2, 3, 4].map((colIdx) => {
                  const guess = rowIdx === guesses.length ? currentGuess : guesses[rowIdx];
                  const letter = guess ? guess[colIdx] : '';
                  const color = (guess && rowIdx < guesses.length) ? getTileColor(letter, colIdx, guess) : '';
                  return (
                    <div key={colIdx} className={'lv-tile ' + color}>
                      {letter || ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {!gameWon && guesses.length < 6 && (
            <div className="lv-keyboard">
              {[
                ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
                ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
                ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK']
              ].map((row, i) => (
                <div key={i} className="lv-keyboard-row">
                  {row.map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyPress(key)}
                      className={'lv-key ' + (key.length > 1 ? 'lv-key-wide' : '')}
                    >
                      {key === 'BACK' ? '←' : key}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {gameWon && (
            <div className="lv-glass" style={{ textAlign: 'center', padding: '32px', boxShadow: '0 0 30px rgba(0,245,255,0.5)' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
              <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px' }}>VAULT CRACKED!</h2>
              <p style={{ color: '#00F5FF' }}>+50 Barnacle Bucks added to your pod</p>
            </div>
          )}
        </div>
      )}

      {(activeTab === 'learn' || activeTab === 'reef' || activeTab === 'tides') && (
        <div className="lv-view">
          <h1 className="lv-title" style={{ fontSize: '36px' }}>
            {activeTab === 'learn' && 'The Depths'}
            {activeTab === 'reef' && 'The Reef'}
            {activeTab === 'tides' && 'The Tides'}
          </h1>
          <p className="lv-subtitle">
            {activeTab === 'learn' && 'Master your financial education'}
            {activeTab === 'reef' && 'Connect with your Pod'}
            {activeTab === 'tides' && 'Live markets & news'}
          </p>
          <div className="lv-glass" style={{ textAlign: 'center', padding: '60px 24px' }}>
            <Sparkles size={48} color="#00F5FF" style={{ marginBottom: '16px' }} />
            <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: '24px', marginBottom: '12px' }}>
              Coming Soon
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>
              This feature is being deployed in the next wave
            </p>
          </div>
        </div>
      )}

      {showPaywall && (
        <div className="lv-modal" onClick={() => setShowPaywall(false)}>
          <div className="lv-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="lv-close" onClick={() => setShowPaywall(false)}>
              <X size={24} />
            </button>

            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <Crown size={64} color="#FFD700" style={{ marginBottom: '20px' }} />
              <h2 className="lv-title" style={{ fontSize: '40px', marginBottom: '12px' }}>
                Unlock Your Financial Future
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>
                Choose the plan that fits your goals
              </p>
            </div>

            <div className="lv-tiers">
              {Object.entries(tiers).map(([key, tier]) => (
                <div
                  key={key}
                  className={'lv-tier ' + (selectedTier === key ? 'selected' : '')}
                  onClick={() => {
                    playSound('bubble');
                    setSelectedTier(key);
                  }}
                >
                  {tier.badge && <div className="lv-tier-badge">{tier.badge}</div>}
                  <div className="lv-tier-icon">{tier.icon}</div>
                  <h3 className="lv-tier-name">{tier.name}</h3>
                  <p className="lv-tier-tagline">{tier.tagline}</p>

                  <div className="lv-tier-price">
                    <span className="lv-price-big">
                      ${billingCycle === 'annual' ? tier.price.annual : tier.price.monthly}
                    </span>
                    <span className="lv-price-small">/{billingCycle === 'annual' ? 'year' : 'month'}</span>
                  </div>

                  {billingCycle === 'annual' && tier.savings && (
                    <div style={{ textAlign: 'center', fontSize: '14px', color: '#00FF88', fontWeight: 600, marginBottom: '24px' }}>
                      Save ${tier.savings}/year
                    </div>
                  )}

                  <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginTop: '16px' }}>
                    {tier.features.slice(0, 3).map((f, i) => (
                      <div key={i} style={{ marginBottom: '8px' }}>• {f}</div>
                    ))}
                    <div style={{ color: '#00F5FF', marginTop: '12px' }}>
                      +{tier.features.length - 3} more features
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="lv-subscribe-btn"
              onClick={() => {
                playSound('success');
                setCurrentTier(selectedTier);
                setShowPaywall(false);
              }}
            >
              <Sparkles size={20} />
              Start 7-Day Free Trial
            </button>

            <p style={{ textAlign: 'center', fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '16px' }}>
              No credit card required • Cancel anytime • 14-day money-back guarantee
            </p>
          </div>
        </div>
      )}

      <div className="lv-nav">
        <div className="lv-nav-items">
          {[
            { id: 'vault', icon: Target, label: 'Vault' },
            { id: 'learn', icon: Award, label: 'Learn' },
            { id: 'home', icon: Home, label: 'Harbor' },
            { id: 'reef', icon: Users, label: 'Reef' },
            { id: 'tides', icon: TrendingUp, label: 'Tides' }
          ].map(({ id, icon: Icon, label }) => (
            <div
              key={id}
              className={'lv-nav-item ' + (activeTab === id ? 'active' : '')}
              onClick={() => {
                playSound('wave');
                setActiveTab(id);
              }}
            >
              <Icon size={22} />
              <span className="lv-nav-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LifeVest;
