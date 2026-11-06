import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { labPortalApi, errorMessage } from '../../shared/services/api';
import usePolling from '../../shared/hooks/usePolling';
import useAuth from '../auth/useAuth';
import { safeInternalPath } from '../../shared/lib/safePath';
import {
  Shield,
  Cpu,
  Wifi,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Clock,
  Users,
  Lock,
} from 'lucide-react';
import './LabTransitionPage.css';

const QUEUE_POLL_MS = 4000;
const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The steps shown while we check, reserve and connect. `at` is the state that completes each step. */
const STEPS = [
  { id: 'session', label: 'Checking your account', detail: 'Signed-in learner, Lab ID and access policy', icon: Shield },
  { id: 'slot', label: 'Checking your lab slot', detail: 'Is your batch scheduled for the lab right now', icon: Clock },
  { id: 'seat', label: 'Reserving a seat', detail: 'A seat is held for you for a few minutes', icon: Cpu },
  { id: 'connect', label: 'Opening the lab', detail: 'Your isolated Linux sandbox starts next', icon: Wifi },
];

function stepIndex(view) {
  if (view.phase === 'checking') return 1;
  if (view.phase === 'reserved') return 3;
  return 2;
}

export default function LabTransitionPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { isRegistered } = useAuth();

  const unitParam = params.unitId || searchParams.get('unit');
  const toParam = searchParams.get('to');
  const targetUrl = toParam
    ? safeInternalPath(toParam)
    : unitParam
      ? `/lab/${encodeURIComponent(unitParam)}`
      : '/dashboard';

  // phase: checking | queued | reserved | no_slot | blocked | error
  const [view, setView] = useState({ phase: 'checking' });
  const entered = useRef(false);

  const apply = useCallback((state) => {
    switch (state.state) {
      case 'open':
      case 'running':
      case 'ready':
        setView({ phase: 'reserved', state });
        break;
      case 'queued':
      case 'full':
        setView({ phase: 'queued', state });
        break;
      case 'available':
        setView({ phase: 'checking', state });
        break;
      case 'no_slot':
        setView({ phase: 'no_slot', state });
        break;
      case 'blocked':
        setView({ phase: 'blocked', state });
        break;
      default:
        setView({ phase: 'error', message: 'The lab returned an answer this page does not understand.' });
    }
  }, []);

  // Take a seat (or a place in the queue) once.
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    labPortalApi.enter(unitParam)
      .then((res) => {
        labPortalApi.event('transition_step', { step: 'enter', ok: true });
        apply(res.data.data);
      })
      .catch((err) => {
        labPortalApi.event('transition_step', { step: 'enter', ok: false });
        labPortalApi.event('transition_failed', { step: 'enter' });
        setView({ phase: 'error', message: errorMessage(err, 'Could not reach the lab. Please try again.') });
      });
  }, [apply, unitParam]);

  // While waiting, keep the place alive and watch for the seat.
  const refresh = useCallback(() => {
    labPortalApi.availability().then((res) => apply(res.data.data)).catch(() => {});
  }, [apply]);
  usePolling(refresh, QUEUE_POLL_MS, view.phase === 'queued');

  // A reserved seat goes straight into the lab.
  useEffect(() => {
    if (view.phase !== 'reserved') return undefined;
    labPortalApi.event('transition_step', { step: 'connect', ok: true });
    navigate(targetUrl, { replace: true });
    return undefined;
  }, [view.phase, navigate, targetUrl]);

  const leave = async () => {
    await labPortalApi.leaveQueue().catch(() => {});
    navigate(unitParam ? `/unit/${encodeURIComponent(unitParam)}/learn` : '/dashboard');
  };

  const active = stepIndex(view);
  const state = view.state;
  const queue = state?.queue;

  return (
    <div className="lab-portal-stage">
      <div className="portal-ambient-glow portal-glow-top" />
      <div className="portal-ambient-glow portal-glow-bottom" />

      <div className="portal-container">
        <div className="portal-card animate-scale-in">
          <div className="portal-badge-pill">
            <span className="portal-pulse-dot" />
            <span className="portal-badge-text">OPSACADEMY LAB</span>
          </div>

          {view.phase === 'queued' && (
            <>
              <h1 className="portal-title">You are in the queue</h1>
              <p className="portal-subtitle">The lab is full right now. Keep this page open: you go in as soon as a seat frees up.</p>
              <div className="portal-queue" role="status" aria-live="polite">
                <div><Users size={16} /> <strong>#{queue?.position ?? '…'}</strong><span>your place</span></div>
                <div><Clock size={16} /> <strong>~{queue?.estimatedWaitMinutes ?? '…'} min</strong><span>estimated wait</span></div>
                <div><Users size={16} /> <strong>{queue?.waiting ?? '…'}</strong><span>waiting</span></div>
              </div>
              <div className="portal-footer"><button type="button" className="portal-enter-btn" onClick={leave}>Leave the queue</button></div>
            </>
          )}

          {view.phase === 'no_slot' && (
            <>
              <h1 className="portal-title">No lab slot right now</h1>
              <p className="portal-subtitle">
                {state?.nextSlot ? <>Your next lab slot starts <strong>{fmt(state.nextSlot.startsAt)}</strong>. Keep learning the theory until then.</> : 'No lab slot is assigned to you yet. Ask your trainer.'}
              </p>
              <div className="portal-footer"><Link to={unitParam ? `/unit/${encodeURIComponent(unitParam)}/learn` : '/dashboard'} className="portal-enter-btn">Back to theory <ArrowRight size={16} /></Link></div>
            </>
          )}

          {view.phase === 'blocked' && (
            <>
              <h1 className="portal-title"><Lock size={22} /> {state?.reason === 'account_disabled' ? 'Account disabled' : 'Lab ID needed'}</h1>
              <p className="portal-subtitle">
                {state?.reason === 'account_disabled' ? 'This account is disabled. Ask your admin.' : 'Labs are open to Lab IDs. Sign in with the Lab ID and password your admin gave you.'}
              </p>
              <div className="portal-footer"><Link to="/login" className="portal-enter-btn">{isRegistered ? 'Switch to a Lab ID' : 'Sign in'} <ArrowRight size={16} /></Link></div>
            </>
          )}

          {view.phase === 'error' && (
            <>
              <h1 className="portal-title">Could not open the lab</h1>
              <p className="portal-subtitle" role="alert">{view.message}</p>
              <div className="portal-footer"><button type="button" className="portal-enter-btn" onClick={() => window.location.reload()}>Try again</button></div>
            </>
          )}

          {(view.phase === 'checking' || view.phase === 'reserved') && (
            <>
              <h1 className="portal-title">Welcome to the Labs</h1>
              <p className="portal-subtitle">Getting your isolated Linux sandbox ready.</p>
              <div className="portal-stepper">
                {STEPS.map((step, i) => {
                  const done = i < active || view.phase === 'reserved';
                  const current = i === active && view.phase !== 'reserved';
                  const Icon = step.icon;
                  return (
                    <div key={step.id} className={`portal-step-item ${done ? 'done' : current ? 'active' : 'pending'}`}>
                      <div className="portal-step-icon-wrap">
                        {done ? <CheckCircle2 size={16} className="text-emerald-500" /> : current ? <Loader2 size={15} className="portal-spin-icon" /> : <Icon size={15} className="step-icon" />}
                      </div>
                      <div className="portal-step-content">
                        <span className="portal-step-label">{step.label}</span>
                        <span className="portal-step-detail">{step.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="portal-footer">
                <Link to={targetUrl} className="portal-enter-btn"><span>Enter Lab Cockpit</span><ArrowRight size={16} /></Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
