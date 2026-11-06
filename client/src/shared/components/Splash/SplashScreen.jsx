import { useEffect, useState } from 'react';
import './SplashScreen.css';

const SEEN_KEY = 'opsacademy_splash_seen';
const SHOW_MS = 1900; // how long the logo is on screen
const FADE_MS = 450;  // the fade-out, matching the CSS

/** Once per visit, and never for automated browsers or people who ask for less motion. */
function shouldShow() {
  try {
    if (navigator.webdriver) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (sessionStorage.getItem(SEEN_KEY)) return false;
    sessionStorage.setItem(SEEN_KEY, '1');
    return true;
  } catch {
    return false; // storage blocked: skip the splash rather than show it on every page
  }
}

/**
 * The logo pops in, the name is typed out, then the screen lifts to reveal the app. The app is already loading
 * underneath, so the splash never delays it.
 */
export default function SplashScreen() {
  const [phase, setPhase] = useState(() => (shouldShow() ? 'show' : 'gone'));

  useEffect(() => {
    if (phase !== 'show') return undefined;
    const lift = setTimeout(() => setPhase('leaving'), SHOW_MS);
    const done = setTimeout(() => setPhase('gone'), SHOW_MS + FADE_MS);
    return () => { clearTimeout(lift); clearTimeout(done); };
  }, [phase]);

  if (phase === 'gone') return null;
  return (
    <div className={`splash ${phase === 'leaving' ? 'is-leaving' : ''}`} role="presentation" aria-hidden="true">
      <div className="splash-glow" />
      <div className="splash-logo"><span>&gt;_</span></div>
      <div className="splash-name">
        {'OpsAcademy'.split('').map((letter, i) => (
          <span key={i} className={i >= 3 ? 'is-accent' : ''} style={{ animationDelay: `${0.55 + i * 0.07}s` }}>{letter}</span>
        ))}
      </div>
      <div className="splash-tagline">Learn it. Break it. Fix it.</div>
      <div className="splash-bar"><span /></div>
    </div>
  );
}
