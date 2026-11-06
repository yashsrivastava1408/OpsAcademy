import { Link, useLocation } from 'react-router-dom';
import { BookOpen, FlaskConical } from 'lucide-react';
import { labPortalApi } from '../../services/api';
import useLabAvailability from '../../hooks/useLabAvailability';

/** What the Lab button says for each state the server can report. */
function labHint(state) {
  if (!state) return null;
  switch (state.state) {
    case 'queued': return `In queue (#${state.queue?.position ?? '?'})`;
    case 'full': return 'Lab is full';
    case 'no_slot': return 'No slot now';
    case 'blocked': return state.reason === 'account_disabled' ? 'Disabled' : 'Needs Lab ID';
    default: return null;
  }
}

/**
 * Theory ↔ Lab switch. Inside the lab it takes the learner back to the theory side of the same unit;
 * elsewhere it goes to the transition screen, which checks the slot and the queue.
 */
export default function PortalSwitch({ enabled }) {
  const { pathname } = useLocation();
  const state = useLabAvailability(15000, enabled);
  const unit = pathname.match(/^\/(?:unit|lab)\/([^/]+)/)?.[1];
  const inLab = /^\/lab\//.test(pathname) || /\/practice$/.test(pathname);

  if (inLab) {
    return (
      <Link to={unit ? `/unit/${unit}/learn` : '/dashboard'} className="btn btn-secondary btn-sm hide-mobile" onClick={() => labPortalApi.event('switch_to_theory')}>
        <BookOpen size={14} /> Theory
      </Link>
    );
  }
  const hint = labHint(state);
  const to = unit ? `/lab/${unit}/enter` : '/portal/lab';
  return (
    <Link to={to} className="btn btn-primary btn-sm hide-mobile" onClick={() => labPortalApi.event('switch_to_lab')} title={hint ? `Lab: ${hint}` : 'Go to the lab'}>
      <FlaskConical size={14} /> Lab{hint ? ` · ${hint}` : ''}
    </Link>
  );
}
