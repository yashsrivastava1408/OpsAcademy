import { useEffect, useRef } from 'react';

/**
 * Call `callback` now and then every `intervalMs`, but only while the tab is
 * visible. A hidden tab stops asking the server for updates and catches up
 * the moment it is shown again.
 */
export default function usePolling(callback, intervalMs, enabled = true) {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    const tick = () => latest.current();
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
