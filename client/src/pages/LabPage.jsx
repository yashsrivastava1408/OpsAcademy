import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  Loader,
  BookOpen,
  Award,
  Bot,
  Activity,
  RotateCcw,
} from 'lucide-react';
import Terminal from '../components/Terminal/Terminal';
import MentorChat from '../components/MentorChat/MentorChat';
import DevOpsInspector from '../components/DevOpsInspector/DevOpsInspector';
import { sandboxApi, unitApi, labApi, errorMessage } from '../services/api';
import { refreshProgress } from '../services/progressService';
import usePolling from '../hooks/usePolling';
import useProgress from '../hooks/useProgress';
import './LabPage.css';

const HISTORY_POLL_MS = 4000;
const CLOSING_WARNING_MS = 2 * 60 * 1000;

const formatClock = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
};

/**
 * Warns before the gateway closes the sandbox, so work is not lost without
 * notice. An idle sandbox can be kept; the overall session limit cannot be extended.
 */
function ClosingWarning({ closing, onKeep }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [closing]);

  if (!closing) return null;
  const idleLeft = closing.idleExpiresAt - now;
  const ageLeft = closing.expiresAt - now;
  if (Math.min(idleLeft, ageLeft) > CLOSING_WARNING_MS) return null;

  // The session limit wins when it comes first: keeping the sandbox would not help.
  if (ageLeft <= idleLeft) {
    return (
      <div className="lab-closing-banner" role="status">
        <Clock size={14} />
        <span>
          This sandbox reaches its time limit in <strong>{formatClock(ageLeft)}</strong>. Verify your steps now;
          files in the sandbox are deleted when it closes.
        </span>
      </div>
    );
  }
  return (
    <div className="lab-closing-banner" role="alert">
      <Clock size={14} />
      <span>
        No activity for a while. This sandbox closes in <strong>{formatClock(idleLeft)}</strong> and its files are deleted.
      </span>
      <button className="btn btn-primary btn-xs" onClick={onKeep}>Keep it open</button>
    </div>
  );
}

/**
 * Time since the sandbox started. It ticks in its own component so the lab
 * page (instructions, terminal, inspector) is not re-rendered every second.
 */
function LabTimer({ startedAt }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const sec = (seconds % 60).toString().padStart(2, '0');
  return (
    <span className="lab-timer">
      <Clock size={14} />
      {m}:{sec}
    </span>
  );
}

/** Render `backticked` parts of a task as inline code. */
function renderInlineCode(text) {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i} className="task-code">{part}</code> : part));
}

export default function LabPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const terminalRef = useRef(null);
  const startingRef = useRef(false);

  const [meta, setMeta] = useState(null);
  const [practiceData, setPracticeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [sessionId, setSessionId] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [showHint, setShowHint] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [closing, setClosing] = useState(null); // when the gateway will close the sandbox, in this browser's clock
  const progress = useProgress();
  const [verifyResult, setVerifyResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showMentor, setShowMentor] = useState(false);
  // On a phone the inspector would cover the terminal, so it starts closed there.
  const [showInspector, setShowInspector] = useState(() => window.innerWidth > 900);
  // Narrow screens show one panel at a time.
  const [mobilePanel, setMobilePanel] = useState('instructions');
  // Some phones report a desktop-sized window until the page has laid out, so check again once mounted.
  useEffect(() => {
    if (window.innerWidth <= 900) setShowInspector(false);
  }, []);
  const [commandHistory, setCommandHistory] = useState([]);
  const [startError, setStartError] = useState(null);
  const [verifiedSteps, setVerifiedSteps] = useState({});
  const [focusStep, setFocusStep] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setLoadError(null);
      try {
        const [metaRes, practiceRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'practice'),
        ]);
        if (cancelled) return;
        setMeta(metaRes.data.data);
        setPracticeData(practiceRes.data.data);

        // Pick up a sandbox for this lab that is still running, e.g. after a page reload.
        const running = await sandboxApi.list().catch(() => null);
        const existing = running?.data?.data?.find((s) => s.labId === unitId);
        if (!cancelled && existing) {
          setSessionId(existing.sessionId);
          setStartedAt(Date.now() - existing.uptime);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err.response?.status === 404
            ? 'not_found'
            : 'The server did not respond. If it has been idle it can take up to a minute to wake up.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [unitId, loadAttempt]);

  // The gateway reports its own clock, so a wrong clock on this machine does not skew the countdown.
  const noteClosingTimes = useCallback((session) => {
    if (!session) return;
    const skew = Date.now() - session.serverTime;
    const next = { expiresAt: session.expiresAt + skew, idleExpiresAt: session.idleExpiresAt + skew };
    setClosing((prev) => (
      prev && Math.abs(prev.expiresAt - next.expiresAt) < 1500 && Math.abs(prev.idleExpiresAt - next.idleExpiresAt) < 1500 ? prev : next
    ));
  }, []);

  const keepSandbox = useCallback(async () => {
    try {
      const res = await sandboxApi.keepAlive(sessionId);
      noteClosingTimes(res.data.session);
    } catch { /* the sandbox is already gone; the terminal reports it */ }
  }, [sessionId, noteClosingTimes]);

  // Commands the student has typed, as recorded by the gateway
  const loadHistory = useCallback(async () => {
    try {
      const res = await sandboxApi.getHistory(sessionId);
      noteClosingTimes(res.data.session);
      setCommandHistory((prev) => {
        const next = res.data.data.map((entry) => entry.command);
        // Keep the same array when nothing changed, so nothing re-renders.
        return next.length === prev.length && next.every((command, i) => command === prev[i]) ? prev : next;
      });
    } catch { /* the session ended; the terminal reports it */ }
  }, [sessionId, noteClosingTimes]);

  useEffect(() => {
    if (!sessionId) {
      setCommandHistory([]);
      setClosing(null);
    }
  }, [sessionId]);

  usePolling(loadHistory, HISTORY_POLL_MS, Boolean(sessionId));

  const startLab = async () => {
    // Both Start buttons call this; a double click must not start two sandboxes.
    if (startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    setStartError(null);
    try {
      const res = await sandboxApi.start(unitId);
      const sandbox = res.data.data;
      setSessionId(sandbox.sessionId);
      setMobilePanel('terminal');
      // The gateway hands back a sandbox that is already running for this lab.
      setStartedAt(sandbox.resumed ? Date.now() - sandbox.uptime : Date.now());
      if (!sandbox.resumed) setVerifiedSteps({});
    } catch (err) {
      setStartError(
        err.response
          ? errorMessage(err)
          : 'The sandbox gateway did not respond. If it has been idle it may be waking up; try again in a few seconds.'
      );
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const stopLab = async () => {
    if (!sessionId) return;
    const currId = sessionId;
    setSessionId(null);
    try {
      await sandboxApi.stop(currId);
    } catch {
      // Session already reaped or closed
    }
  };

  const resetLab = async () => {
    if (!sessionId) return;
    if (!window.confirm('Reset this lab? Every file you created in the sandbox will be deleted.')) return;
    try {
      await sandboxApi.reset(sessionId);
      setVerifiedSteps({});
      setVerifyResult(null);
    } catch (err) {
      setStartError(errorMessage(err, 'Could not reset the sandbox.'));
    }
  };

  const handleDisconnect = useCallback(() => setSessionId(null), []);

  const runInTerminal = useCallback((command) => {
    if (terminalRef.current) terminalRef.current.send(`${command}\r`);
  }, []);

  const closeInspector = useCallback(() => setShowInspector(false), []);

  const verify = async (stepNumber) => {
    if (!sessionId) return;
    setIsVerifying(true);
    setVerifyResult({ status: 'checking' });
    if (stepNumber) setFocusStep(stepNumber);

    try {
      const res = await labApi.verify(unitId, sessionId, stepNumber);
      const data = res.data;

      setVerifiedSteps((prev) => {
        const next = { ...prev };
        data.results.forEach((r) => { next[r.step] = r.passed; });
        return next;
      });
      // After a full run, focus on the first step that failed.
      const firstFailed = data.results.find((r) => !r.passed);
      if (!stepNumber && firstFailed) setFocusStep(firstFailed.step);
      setVerifyResult({
        status: data.allPassed ? 'pass' : 'fail',
        stepNumber,
        xpEarned: data.xpEarned,
        dailyBonus: data.dailyBonus,
        score: data.score,
        unitCompleted: data.unitCompleted,
        details: data.results,
      });
      refreshProgress();
    } catch (err) {
      setVerifyResult({ status: 'error', message: errorMessage(err, 'Verification could not run. Is the sandbox still running?') });
    } finally {
      setIsVerifying(false);
    }
  };

  const toggleStep = (step) => {
    setExpandedSteps((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const toggleHint = (step) => {
    setShowHint((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  if (loading) {
    return (
      <div className="lab-not-found">
        <Loader size={36} className="spin" />
        <p>Loading lab instructions...</p>
      </div>
    );
  }

  if (loadError === 'not_found' || (!loadError && (!meta || !practiceData))) {
    return (
      <div className="lab-not-found">
        <h2>Lab not found</h2>
        <p>The practice lab for "{unitId}" doesn't exist.</p>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="lab-not-found">
        <h2>Couldn't load this lab</h2>
        <p>{loadError}</p>
        <button className="btn btn-primary" onClick={() => setLoadAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  const steps = practiceData.steps || [];
  // Steps passed on an earlier visit stay ticked; a check run in this visit overrides them.
  const verified = { ...verifiedSteps };
  for (const step of progress.unitProgress[unitId]?.passedStepNumbers || []) {
    if (!(step in verified)) verified[step] = true;
  }
  // The mentor helps with the step the student last checked and has not passed;
  // otherwise with the first step that has not been verified yet.
  const currentStep = steps.find((s) => s.step === focusStep && !verified[s.step])
    || steps.find((s) => !verified[s.step])
    || steps[steps.length - 1];

  return (
    <div className="lab-page">
      {/* ── Lab Header ───────────────────────────────────── */}
      <div className="lab-header">
        <div className="lab-header-left">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="lab-header-info">
            <h1 className="lab-title">{meta.title}</h1>
            <div className="lab-meta">
              <span className={`badge badge-${meta.difficulty}`}>{meta.difficulty}</span>
              <span className="lab-meta-item">
                <Clock size={12} />
                {meta.duration}
              </span>
              <span className="lab-meta-item">{meta.category}</span>
            </div>
          </div>
        </div>

        <div className="lab-header-right">
          <Link to={`/unit/${unitId}/learn`} className="btn btn-ghost btn-sm">
            <BookOpen size={14} /> Learn Theory
          </Link>
          <Link to={`/unit/${unitId}/prepare`} className="btn btn-ghost btn-sm">
            <Award size={14} /> Prepare Q&A
          </Link>

          <button
            className={`btn btn-sm ${showInspector ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowInspector(!showInspector)}
            title="Toggle Live DevOps File & Process Inspector"
          >
            <Activity size={14} /> Inspector
          </button>

          <button
            className={`btn btn-sm ${showMentor ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowMentor(!showMentor)}
          >
            <Bot size={14} /> AI Mentor
          </button>

          {sessionId && startedAt && <LabTimer startedAt={startedAt} />}

          {!sessionId ? (
            <button className="btn btn-primary" onClick={startLab} disabled={isStarting}>
              {isStarting ? (
                <>
                  <Loader size={16} className="spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start Lab
                </>
              )}
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={resetLab} title="Delete everything in the sandbox and start the lab over">
                <RotateCcw size={14} />
                Reset
              </button>
              <button className="btn btn-secondary btn-sm" onClick={stopLab}>
                <Square size={14} />
                Stop
              </button>
              <button className="btn btn-success btn-sm" onClick={() => verify()} disabled={isVerifying}>
                <CheckCircle2 size={14} />
                Verify All
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Start Error Alert Banner ─────────────────────── */}
      {startError && (
        <div className="lab-alert-banner" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', padding: '8px 16px', borderRadius: '8px', margin: '0 24px 12px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {startError}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setStartError(null)} style={{ color: '#fca5a5' }}>Dismiss</button>
        </div>
      )}

      <ClosingWarning closing={sessionId ? closing : null} onKeep={keepSandbox} />

      {/* ── Split Pane: Instructions | Terminal | Inspector ──── */}
      <div className="lab-panel-tabs" role="tablist">
        <button role="tab" aria-selected={mobilePanel === 'instructions'} className={mobilePanel === 'instructions' ? 'active' : ''} onClick={() => setMobilePanel('instructions')}>
          <BookOpen size={14} /> Instructions
        </button>
        <button role="tab" aria-selected={mobilePanel === 'terminal'} className={mobilePanel === 'terminal' ? 'active' : ''} onClick={() => setMobilePanel('terminal')}>
          <Play size={14} /> Terminal
        </button>
      </div>

      <div className="lab-workspace" data-panel={mobilePanel}>
        {/* Instructions Panel */}
        <div className="lab-instructions">
          <div className="instructions-header">
            <h2>Practice Instructions</h2>
            <span className="instructions-count">{steps.length} steps</span>
          </div>

          <div className="instructions-list">
            {steps.map((stepObj) => (
              <div
                key={stepObj.step}
                className={`instruction-item ${
                  expandedSteps[stepObj.step] !== false ? 'expanded' : ''
                } ${verified[stepObj.step] ? 'step-verified' : ''}`}
              >
                <button
                  className="instruction-header-btn"
                  onClick={() => toggleStep(stepObj.step)}
                >
                  <div className={`instruction-step-badge ${verified[stepObj.step] ? 'verified' : ''}`}>
                    {verified[stepObj.step] ? '✓' : stepObj.step}
                  </div>
                  <span className="instruction-title">{stepObj.title}</span>
                  {expandedSteps[stepObj.step] !== false ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </button>

                {expandedSteps[stepObj.step] !== false && (
                  <div className="instruction-content">
                    <p>{stepObj.description}</p>

                    {stepObj.tasks && (
                      <ul className="tasks-bullet-list">
                        {stepObj.tasks.map((task, i) => (
                          <li key={i}>{renderInlineCode(task)}</li>
                        ))}
                      </ul>
                    )}

                    <div className="step-actions-row flex-gap">
                      <button
                        className={`btn btn-xs ${verified[stepObj.step] ? 'btn-success' : 'btn-primary'}`}
                        onClick={() => verify(stepObj.step)}
                        disabled={isVerifying || !sessionId}
                        title={!sessionId ? "Click 'Start Lab' to enable verification" : 'Run this step\'s check in your sandbox'}
                      >
                        <CheckCircle2 size={12} />
                        {verified[stepObj.step] ? 'Verified' : `Verify Step ${stepObj.step}`}
                      </button>

                      {stepObj.hint && (
                        <button
                          className="btn btn-ghost btn-xs hint-toggle"
                          onClick={() => toggleHint(stepObj.step)}
                        >
                          {showHint[stepObj.step] ? 'Hide Hint' : 'Show Hint'}
                        </button>
                      )}
                    </div>

                    {showHint[stepObj.step] && stepObj.hint && (
                      <div className="hint-box mt-2">
                        <code>{stepObj.hint}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Terminal Panel */}
        <div className="lab-terminal">
          <Terminal ref={terminalRef} sessionId={sessionId} onDisconnect={handleDisconnect} onStartLab={startLab} />
        </div>

        {/* Live DevOps File & Telemetry Inspector Side Panel */}
        {/* The mentor drawer uses the same corner, so the inspector steps aside while it is open. */}
        {showInspector && !showMentor && (
          <DevOpsInspector
            sessionId={sessionId}
            unitId={unitId}
            commandHistory={commandHistory}
            onRunCommand={sessionId ? runInTerminal : undefined}
            onClose={closeInspector}
          />
        )}
      </div>

      {/* ── Verify Result Overlay ────────────────────────── */}
      {verifyResult && (
        <div className="verify-overlay" onClick={() => setVerifyResult(null)}>
          <div className="verify-card glass-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
            {verifyResult.status === 'checking' ? (
              <>
                <div className="verify-icon checking">
                  <Loader size={32} className="spin" />
                </div>
                <h3>Verifying your work...</h3>
                <p>Running the checks inside your sandbox</p>
              </>
            ) : verifyResult.status === 'pass' ? (
              <>
                <div className="verify-icon pass">
                  <CheckCircle2 size={32} />
                </div>
                <h3>{verifyResult.unitCompleted ? 'Lab complete!' : 'Verification passed'}</h3>
                <p style={{ color: '#10b981', fontWeight: 600 }}>
                  {verifyResult.xpEarned > 0 ? `+${verifyResult.xpEarned} XP earned` : 'Already verified, no new XP'}
                  {verifyResult.dailyBonus > 0 && ` (includes +${verifyResult.dailyBonus} for the lab of the day)`}
                </p>
                <p>
                  {verifyResult.unitCompleted
                    ? 'Every step in this lab has been verified in your sandbox.'
                    : verifyResult.stepNumber
                      ? `Step ${verifyResult.stepNumber} checks out. On to the next one.`
                      : 'All checks passed.'}
                </p>
                {verifyResult.unitCompleted && (
                  <Link to="/dashboard" className="btn btn-primary btn-sm mb-2">
                    <Award size={14} /> Get your certificate
                  </Link>
                )}
              </>
            ) : verifyResult.status === 'error' ? (
              <>
                <div className="verify-icon fail">
                  <XCircle size={32} />
                </div>
                <h3>Couldn't run the check</h3>
                <p>{verifyResult.message}</p>
              </>
            ) : (
              <>
                <div className="verify-icon fail">
                  <XCircle size={32} />
                </div>
                <h3>Not there yet</h3>
                <p>
                  {verifyResult.details.filter((r) => r.passed).length} of {verifyResult.details.length} checks passed.
                  Compare your sandbox with the tasks, or ask the mentor.
                </p>

                <div className="verify-details-list">
                  {verifyResult.details.map((res, i) => (
                    <div key={i} className={`verify-detail-item ${res.passed ? 'pass' : 'fail'}`}>
                      <span>{res.title || `Step ${res.step}`}</span>
                      <span>{res.passed ? '✓ Passed' : '✗ Not yet'}</span>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-primary btn-sm mb-2"
                  onClick={() => {
                    setVerifyResult(null);
                    setShowMentor(true);
                  }}
                >
                  <Bot size={14} /> Ask the mentor
                </button>
              </>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => setVerifyResult(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── AI Mentor Chat Drawer ───────────────────────── */}
      {showMentor && (
        <MentorChat
          key={currentStep?.step}
          unitId={unitId}
          currentStep={currentStep?.step || 1}
          stepTitle={currentStep?.title}
          sessionId={sessionId}
          onClose={() => setShowMentor(false)}
        />
      )}
    </div>
  );
}
