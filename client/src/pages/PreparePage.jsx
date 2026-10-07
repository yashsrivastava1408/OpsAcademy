import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader,
  MessageSquare,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import { unitApi, progressApi, interviewApi, errorMessage } from '../services/api';
import { refreshProgress } from '../services/progressService';
import Flashcard from '../components/Flashcard/Flashcard';
import './PreparePage.css';

// How well the card was remembered, on the 0-5 scale the scheduler uses.
const GRADES = [
  { grade: 1, label: 'Again', hint: 'in 10 min', className: 'grade-again' },
  { grade: 3, label: 'Hard', hint: '', className: 'grade-hard' },
  { grade: 4, label: 'Good', hint: '', className: 'grade-good' },
  { grade: 5, label: 'Easy', hint: '', className: 'grade-easy' },
];

function formatDue(card) {
  if (!card.seen) return 'New';
  if (card.due) return 'Due now';
  const days = Math.max(1, Math.round((card.dueAt - Date.now()) / 86400000));
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

function MockInterview({ unitId, questions }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const question = questions[index];

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await interviewApi.answer(unitId, question.id, answer);
      setResult(res.data.data);
      refreshProgress();
    } catch (err) {
      setError(errorMessage(err, 'Could not score your answer. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const goTo = (next) => {
    setIndex(next);
    setAnswer('');
    setResult(null);
    setError(null);
  };

  if (!question) {
    return <p className="empty-text">No interview questions available for this unit yet.</p>;
  }

  return (
    <div className="mock-interview animate-fade-in">
      <div className="deck-progress">
        Question {index + 1} of {questions.length}
        <span className={`badge badge-${question.difficulty || 'intermediate'}`}>{question.difficulty}</span>
      </div>

      <div className="question-card glass-card mock-question">
        <h3 className="q-title">{question.question}</h3>

        {!result ? (
          <form onSubmit={submit}>
            <textarea
              className="input mock-answer-input"
              placeholder="Answer as you would in an interview: what you would check, in what order, and why."
              value={answer}
              maxLength={4000}
              rows={8}
              onChange={(e) => setAnswer(e.target.value)}
            />
            {error && <p className="mock-error">{error}</p>}
            <div className="mock-actions">
              <span className="mock-count">{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
              <button type="submit" className="btn btn-primary" disabled={submitting || answer.trim().length < 20}>
                {submitting ? <><Loader size={14} className="spin" /> Scoring...</> : 'Submit answer'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mock-result animate-fade-in">
            <div className={`mock-score ${result.score >= result.passScore ? 'pass' : 'fail'}`}>
              <span className="mock-score-value">{result.score}</span>
              <span className="mock-score-label">/ 100</span>
              {result.xpAwarded > 0 && <span className="mock-xp">+{result.xpAwarded} XP</span>}
            </div>
            <p className="mock-feedback">{result.feedback}</p>

            {(result.covered.length > 0 || result.missed.length > 0) && (
              <div className="key-points-box">
                <div className="box-label">Key points interviewers listen for</div>
                <ul className="mock-points">
                  {result.covered.map((point, i) => (
                    <li key={`c${i}`} className="covered"><CheckCircle2 size={14} /> {point}</li>
                  ))}
                  {result.missed.map((point, i) => (
                    <li key={`m${i}`} className="missed"><XCircle size={14} /> {point}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="model-answer-box">
              <div className="box-label">Model Interview Answer</div>
              <p>{result.modelAnswer}</p>
            </div>

            <div className="mock-actions">
              <button className="btn btn-secondary" onClick={() => setResult(null)}>Try again</button>
              {index < questions.length - 1 && (
                <button className="btn btn-primary" onClick={() => goTo(index + 1)}>Next question</button>
              )}
            </div>
          </div>
        )}
      </div>

      {questions.length > 1 && (
        <div className="mock-nav">
          {questions.map((q, i) => (
            <button key={q.id} className={`pill ${i === index ? 'active' : ''}`} onClick={() => goTo(i)}>
              Q{i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PreparePage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // null | 'not_found' | 'offline'
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [grading, setGrading] = useState(false);
  const [activeTab, setActiveTab] = useState('flashcards'); // flashcards | interview | questions
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [expandedQ, setExpandedQ] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        // The schedule is personal and optional: without it the cards are shown in order.
        const [metaRes, contentRes, deckRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'prepare'),
          progressApi.getDeck(unitId).catch(() => null),
        ]);
        if (cancelled) return;

        setMeta(metaRes.data.data);
        setContent(contentRes.data.data);
        setDeck(deckRes ? deckRes.data.data : null);
        setCurrentCardIdx(0);
        setRevealed(false);
      } catch (err) {
        if (cancelled) return;
        // A sleeping server is not the same as content that does not exist.
        setLoadError(err.response ? 'not_found' : 'offline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [unitId, loadAttempt]);

  if (loading) {
    return (
      <div className="prepare-loading">
        <Loader size={36} className="spin" />
        <p>Loading interview prep deck...</p>
      </div>
    );
  }

  if (loadError === 'offline') {
    return (
      <div className="prepare-error">
        <h2>Couldn't load the interview prep</h2>
        <p>The server did not respond. If it has been idle it can take up to a minute to wake up.</p>
        <button className="btn btn-primary" onClick={() => setLoadAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (loadError || !content || !meta) {
    return (
      <div className="prepare-error">
        <h2>Content not found</h2>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  // With the schedule loaded, due cards come first; otherwise show the deck in order.
  const flashcards = deck ? deck.cards : content.flashcards || [];
  const questions = content.interviewQuestions || [];
  const card = flashcards[Math.min(currentCardIdx, flashcards.length - 1)];

  const toggleQuestion = (id) => {
    setExpandedQ((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const showCard = (index) => {
    setCurrentCardIdx(index);
    setRevealed(false);
  };

  const gradeCard = async (grade) => {
    // One review per card: a double click must not schedule it twice.
    if (grading) return;
    setGrading(true);
    try {
      // The answer includes the re-sorted deck.
      const res = await progressApi.reviewCard(unitId, card.id, grade);
      if (res.data.deck) setDeck(res.data.deck);
      refreshProgress();
    } catch { /* keep going through the deck even if the review was not saved */ }
    // The reviewed card moves to the back of the deck, so the next one is at the same position.
    showCard(deck && currentCardIdx >= deck.cards.length - 1 ? 0 : currentCardIdx);
    setGrading(false);
  };

  return (
    <div className="prepare-page">
      {/* Header */}
      <div className="prepare-header">
        <div className="container prepare-header-inner">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={16} /> Dashboard
          </button>
          <div className="prepare-header-title">
            <span className="prepare-badge">Mode: Prepare (Interview Ready)</span>
            <h1>{meta.title} — Placement Q&A</h1>
          </div>
          <div className="prepare-mode-buttons">
            <Link to={`/unit/${unitId}/learn`} className="btn btn-secondary btn-sm">
              <BookOpen size={14} /> Theory
            </Link>
            <Link to={`/unit/${unitId}/practice`} className="btn btn-primary btn-sm">
              <Terminal size={14} /> Practice Lab
            </Link>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="container prepare-container">
        {/* Tab switcher */}
        <div className="prepare-tabs">
          <button
            className={`prepare-tab ${activeTab === 'flashcards' ? 'active' : ''}`}
            onClick={() => setActiveTab('flashcards')}
          >
            <Sparkles size={16} />
            Flashcards ({deck ? `${deck.dueCount} due of ${deck.total}` : flashcards.length})
          </button>
          <button
            className={`prepare-tab ${activeTab === 'interview' ? 'active' : ''}`}
            onClick={() => setActiveTab('interview')}
          >
            <MessageSquare size={16} />
            Mock Interview ({questions.length})
          </button>
          <button
            className={`prepare-tab ${activeTab === 'questions' ? 'active' : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            <Award size={16} />
            Model Answers ({questions.length})
          </button>
        </div>

        {/* Tab 1: Flashcards with spaced repetition */}
        {activeTab === 'flashcards' && (
          <div className="flashcards-section animate-fade-in">
            {card ? (
              <div className="flashcard-deck-wrapper">
                <div className="deck-progress">
                  Card {currentCardIdx + 1} of {flashcards.length}
                  {deck && <span className={`due-chip ${card.due ? 'due' : ''}`}>{formatDue(card)}</span>}
                </div>

                <Flashcard key={card.id} card={card} onFlip={setRevealed} />

                {deck && revealed ? (
                  <div className="grade-row animate-fade-in">
                    <span className="grade-prompt">How well did you remember it?</span>
                    <div className="grade-buttons">
                      {GRADES.map((g) => (
                        <button key={g.grade} className={`btn btn-sm grade-btn ${g.className}`} onClick={() => gradeCard(g.grade)} disabled={grading}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="deck-controls">
                    <button
                      className="btn btn-secondary"
                      disabled={currentCardIdx === 0}
                      onClick={() => showCard(currentCardIdx - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={currentCardIdx === flashcards.length - 1}
                      onClick={() => showCard(currentCardIdx + 1)}
                    >
                      Next Card
                    </button>
                  </div>
                )}

                {deck && deck.dueCount === 0 && (
                  <p className="deck-done">
                    <CheckCircle2 size={14} /> Nothing due right now. Cards come back when you are about to forget them.
                  </p>
                )}
              </div>
            ) : (
              <p className="empty-text">No flashcards available for this unit yet.</p>
            )}
          </div>
        )}

        {/* Tab 2: Mock interview, scored against the rubric */}
        {activeTab === 'interview' && <MockInterview unitId={unitId} questions={questions} />}

        {/* Tab 3: Placement Questions & Model Answers */}
        {activeTab === 'questions' && (
          <div className="questions-section animate-fade-in">
            {questions.length === 0 && <p className="empty-text">No interview questions available for this unit yet.</p>}
            <div className="questions-list">
              {questions.map((q, idx) => (
                <div key={q.id || idx} className="question-card glass-card">
                  <div
                    className="question-card-header"
                    onClick={() => toggleQuestion(q.id || idx)}
                  >
                    <span className="q-number">Q{idx + 1}</span>
                    <h3 className="q-title">{q.question}</h3>
                    <span className={`badge badge-${q.difficulty || 'intermediate'}`}>
                      {q.difficulty}
                    </span>
                    {expandedQ[q.id || idx] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>

                  {expandedQ[q.id || idx] && (
                    <div className="question-card-body animate-fade-in">
                      <div className="model-answer-box">
                        <div className="box-label">Model Interview Answer</div>
                        <p>{q.modelAnswer}</p>
                      </div>

                      {q.keyPoints && (
                        <div className="key-points-box">
                          <div className="box-label">Key Points Recruiters Look For</div>
                          <ul className="key-points-list">
                            {q.keyPoints.map((kp, i) => (
                              <li key={i}>{kp}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
