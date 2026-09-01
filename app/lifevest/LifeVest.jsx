'use client';

import React, { useState, useEffect } from 'react';
import './lifevest.css';
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

  return (
    <div className="lv-app">
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
