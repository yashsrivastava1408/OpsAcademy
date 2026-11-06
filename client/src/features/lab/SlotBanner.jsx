import { useEffect, useState } from 'react';
import { CalendarClock, Clock, Lock } from 'lucide-react';

const WARN_BEFORE_MS = 15 * 60 * 1000;
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * One banner for the lab page: read-only mode outside slot hours (or without a Lab ID), and a countdown to the
 * end of the slot while a sandbox is running. The server closes the sandbox shortly after the slot ends.
 */
export default function SlotBanner({ state }) {
  const [now, setNow] = useState(Date.now);
  const endsAt = state?.state === 'running' ? state.slot?.endsAt : null;

  useEffect(() => {
    if (!endsAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (!state) return null;

  if (state.state === 'blocked') {
    return (
      <div className="lab-slot-banner is-readonly" role="status">
        <Lock size={14} />
        <span>
          Read-only: {state.reason === 'account_disabled' ? 'this account is disabled.' : 'labs need a Lab ID. You can read the instructions, but the terminal will not start.'}
        </span>
      </div>
    );
  }
  if (state.state === 'no_slot') {
    return (
      <div className="lab-slot-banner is-readonly" role="status">
        <CalendarClock size={14} />
        <span>
          Read-only: you have no lab slot right now.
          {state.nextSlot ? <> Your next slot starts <strong>{when(state.nextSlot.startsAt)}</strong>.</> : ' Ask your trainer for a slot.'}
        </span>
      </div>
    );
  }
  if (endsAt && endsAt - now <= WARN_BEFORE_MS) {
    const left = endsAt - now;
    return (
      <div className={`lab-slot-banner ${left <= 5 * 60 * 1000 ? 'is-urgent' : ''}`} role={left <= 5 * 60 * 1000 ? 'alert' : 'status'}>
        <Clock size={14} />
        <span>{left > 0 ? <>Your lab slot ends in <strong>{clock(left)}</strong>. Verify your steps now.</> : 'Your lab slot has ended. This sandbox is about to close.'}</span>
      </div>
    );
  }
  return null;
}
