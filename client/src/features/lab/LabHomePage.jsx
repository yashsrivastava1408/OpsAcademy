import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FlaskConical, Lock, Search, Terminal, Users } from 'lucide-react';
import { unitApi } from '../../shared/services/api';
import useLabAvailability from './useLabAvailability';
import './LabHomePage.css';

const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What the learner's lab state means for this page: can they open a lab, and what do we tell them. */
function describe(state) {
  switch (state?.state) {
    case 'blocked':
      return state.reason === 'account_disabled'
        ? { locked: true, tone: 'warn', icon: Lock, title: 'This account is disabled', text: 'Ask your admin to switch it back on.' }
        : { locked: true, tone: 'info', icon: Lock, title: 'Labs need a Lab ID', text: 'Your account is for theory. Ask your college or admin for a Lab ID, then sign in with it.', action: { to: '/login?tab=lab', label: 'Lab login' } };
    case 'no_slot':
      return { locked: true, tone: 'info', icon: CalendarClock, title: 'No lab slot right now', text: state.nextSlot ? `Your next slot starts ${fmt(state.nextSlot.startsAt)}. Study the theory until then.` : 'No slot is assigned to you yet. Ask your trainer.' };
    case 'queued':
    case 'full':
      return { locked: false, tone: 'warn', icon: Users, title: 'The lab is busy', text: `You will wait in a queue, about ${state.queue?.estimatedWaitMinutes ?? '?'} min. Pick a topic to join it.` };
    case 'running':
      return { locked: false, tone: 'ok', icon: Terminal, title: 'You have a lab running', text: 'Open the topic to go back to it.' };
    case 'available':
    case 'ready':
      return { locked: false, tone: 'ok', icon: FlaskConical, title: state.slot ? `Your slot ends ${new Date(state.slot.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Seats are free', text: 'Pick a topic and you are in.' };
    default:
      return null;
  }
}

/** Lab Studio: every topic, one click to its lab. Access (Lab ID, slot, queue) is explained here and enforced by the server. */
export default function LabHomePage() {
  const state = useLabAvailability(10000);
  const [units, setUnits] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    unitApi.list().then((res) => { if (!cancelled) setUnits(res.data.data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? units.filter((u) => `${u.title} ${u.category}`.toLowerCase().includes(q)) : units;
  }, [units, query]);

  const status = describe(state);
  const locked = Boolean(status?.locked);

  return (
    <div className="lab-home">
      <div className="container">
        <header className="lab-home-head">
          <div>
            <span className="oa-card-kicker">Lab Studio</span>
            <h1>Hands-on labs</h1>
            <p>A real Linux terminal for every topic, with automatic checks and an AI mentor that guides without giving the answer away.</p>
          </div>
          <label className="lab-home-search">
            <Search size={15} />
            <input type="search" placeholder="Search topics" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search topics" />
          </label>
        </header>

        {status && (
          <div className={`lab-home-status tone-${status.tone}`} role="status">
            <status.icon size={18} />
            <div>
              <strong>{status.title}</strong>
              <span>{status.text}</span>
            </div>
            {status.action && <Link to={status.action.to} className="btn btn-primary btn-sm">{status.action.label}</Link>}
          </div>
        )}

        <div className="oa-grid">
          {shown.map((unit) => (
            <article key={unit.id} className={`oa-card ${locked ? 'is-locked' : ''}`}>
              <div className="oa-card-head">
                <div className="oa-card-icon"><Terminal size={18} /></div>
                <div>
                  <div className="oa-card-kicker">{unit.category}</div>
                  <h3 className="oa-card-title">{unit.title}</h3>
                </div>
              </div>
              <p className="oa-card-sub">{unit.description}</p>
              <div className="oa-card-chips">
                {unit.difficulty && <span className="oa-chip">{unit.difficulty}</span>}
                {unit.duration && <span className="oa-chip">{unit.duration}</span>}
              </div>
              <div className="oa-card-foot">
                {locked ? (
                  <span className="oa-link is-quiet" aria-disabled="true"><Lock size={12} /> Locked</span>
                ) : (
                  <Link to={`/lab/${unit.id}`} className="oa-link is-lab"><FlaskConical size={13} /> Open lab</Link>
                )}
              </div>
            </article>
          ))}
        </div>
        {units.length > 0 && shown.length === 0 && <p className="lab-home-empty">No topic matches “{query}”.</p>}
      </div>
    </div>
  );
}
