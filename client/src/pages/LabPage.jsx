import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import Terminal from '../components/Terminal/Terminal';
import MentorChat from '../components/MentorChat/MentorChat';
import { sandboxApi, unitApi, labApi } from '../services/api';
import { markUnitCompleted } from '../services/progressService';
import './LabPage.css';

export default function LabPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [practiceData, setPracticeData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [sessionId, setSessionId] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [showHint, setShowHint] = useState({});
  const [elapsedTime, setElapsedTime] = useState(0);
  const [verifyResult, setVerifyResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showMentor, setShowMentor] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [metaRes, practiceRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'practice'),
        ]);

        setMeta(metaRes.data.data);
        setPracticeData(practiceRes.data.data);
      } catch (err) {
        console.error('Failed to load lab data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [unitId]);

  // Timer
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startLab = async () => {
    setIsStarting(true);
    try {
      const res = await sandboxApi.start('student', unitId);
      setSessionId(res.data.data.sessionId);
      setElapsedTime(0);
    } catch (err) {
      console.error('Failed to start sandbox:', err);
      alert('Failed to start sandbox. Is the server running?');
    } finally {
      setIsStarting(false);
    }
  };

  const stopLab = async () => {
    if (sessionId) {
      try {
        await sandboxApi.stop(sessionId);
      } catch (err) {
        console.error('Failed to stop sandbox:', err);
      }
      setSessionId(null);
      setElapsedTime(0);
    }
  };

  const runVerification = async () => {
    if (!sessionId) return;
    setIsVerifying(true);
    setVerifyResult({ status: 'checking' });

    try {
      const res = await labApi.verify(unitId, sessionId);
      const data = res.data;

      if (data.allPassed) {
        markUnitCompleted(unitId);
        setVerifyResult({ status: 'pass', details: data.results });
      } else {
        setVerifyResult({ status: 'fail', details: data.results });
      }
    } catch (err) {
      console.error('Verification error:', err);
      setVerifyResult({ status: 'fail', details: [{ error: err.message }] });
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

  if (!meta || !practiceData) {
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

  const steps = practiceData.steps || [];

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
            className={`btn btn-sm ${showMentor ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowMentor(!showMentor)}
          >
            <Bot size={14} /> AI Mentor
          </button>

          {sessionId && (
            <span className="lab-timer">
              <Clock size={14} />
              {formatTime(elapsedTime)}
            </span>
          )}

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
              <button className="btn btn-secondary btn-sm" onClick={stopLab}>
                <Square size={14} />
                Stop
              </button>
              <button className="btn btn-success btn-sm" onClick={runVerification} disabled={isVerifying}>
                <CheckCircle2 size={14} />
                Verify
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Split Pane: Instructions | Terminal ──────────── */}
      <div className="lab-workspace">
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
                }`}
              >
                <button
                  className="instruction-header-btn"
                  onClick={() => toggleStep(stepObj.step)}
                >
                  <div className="instruction-step-badge">{stepObj.step}</div>
                  <span className="instruction-title">{stepObj.title}</span>
                  {expandedSteps[stepObj.step] === false ? (
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
                          <li key={i}>{task}</li>
                        ))}
                      </ul>
                    )}

                    {stepObj.hint && (
                      <div className="instruction-hint-area">
                        <button
                          className="btn btn-ghost btn-sm hint-toggle"
                          onClick={() => toggleHint(stepObj.step)}
                        >
                          {showHint[stepObj.step] ? 'Hide Hint' : 'Show Hint'}
                        </button>
                        {showHint[stepObj.step] && (
                          <div className="hint-box">
                            <code>{stepObj.hint}</code>
                          </div>
                        )}
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
          <Terminal sessionId={sessionId} onDisconnect={() => setSessionId(null)} onStartLab={startLab} />
        </div>
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
                <p>Checking container state against lab objectives</p>
              </>
            ) : verifyResult.status === 'pass' ? (
              <>
                <div className="verify-icon pass">
                  <CheckCircle2 size={32} />
                </div>
                <h3>All checks passed! 🎉</h3>
                <p>Great job! You completed all task verifications for this lab.</p>
              </>
            ) : (
              <>
                <div className="verify-icon fail">
                  <XCircle size={32} />
                </div>
                <h3>Some checks failed</h3>
                <p>Check the instructions, make sure your files/commands match, and try again.</p>

                {verifyResult.details && (
                  <div className="verify-details-list">
                    {verifyResult.details.map((res, i) => (
                      <div key={i} className={`verify-detail-item ${res.passed ? 'pass' : 'fail'}`}>
                        <span>{res.title || `Step ${res.step}`}</span>
                        <span>{res.passed ? '✓ Passed' : '✗ Failed'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <button className="btn btn-secondary" onClick={() => setVerifyResult(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── AI Mentor Chat Drawer ───────────────────────── */}
      {showMentor && (
        <MentorChat
          unitId={unitId}
          currentStep={1}
          onClose={() => setShowMentor(false)}
        />
      )}
    </div>
  );
}
