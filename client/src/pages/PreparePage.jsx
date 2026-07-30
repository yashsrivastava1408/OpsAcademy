import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader,
  RotateCw,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { unitApi } from '../services/api';
import Flashcard from '../components/Flashcard/Flashcard';
import './PreparePage.css';

export default function PreparePage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('flashcards'); // flashcards | questions
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [expandedQ, setExpandedQ] = useState({});

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [metaRes, contentRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'prepare'),
        ]);

        setMeta(metaRes.data.data);
        setContent(contentRes.data.data);
      } catch (err) {
        console.error('Failed to load interview prep content:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [unitId]);

  if (loading) {
    return (
      <div className="prepare-loading">
        <Loader size={36} className="spin" />
        <p>Loading interview prep deck...</p>
      </div>
    );
  }

  if (!content || !meta) {
    return (
      <div className="prepare-error">
        <h2>Content not found</h2>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const flashcards = content.flashcards || [];
  const questions = content.interviewQuestions || [];

  const toggleQuestion = (id) => {
    setExpandedQ((prev) => ({ ...prev, [id]: !prev[id] }));
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
            Flashcard Deck ({flashcards.length})
          </button>
          <button
            className={`prepare-tab ${activeTab === 'questions' ? 'active' : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            <Award size={16} />
            Placement Scenarios & Model Answers ({questions.length})
          </button>
        </div>

        {/* Tab 1: Flashcards */}
        {activeTab === 'flashcards' && (
          <div className="flashcards-section animate-fade-in">
            {flashcards.length > 0 ? (
              <div className="flashcard-deck-wrapper">
                <div className="deck-progress">
                  Card {currentCardIdx + 1} of {flashcards.length}
                </div>

                <Flashcard card={flashcards[currentCardIdx]} />

                <div className="deck-controls">
                  <button
                    className="btn btn-secondary"
                    disabled={currentCardIdx === 0}
                    onClick={() => setCurrentCardIdx((prev) => prev - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={currentCardIdx === flashcards.length - 1}
                    onClick={() => setCurrentCardIdx((prev) => prev + 1)}
                  >
                    Next Card
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty-text">No flashcards available for this unit yet.</p>
            )}
          </div>
        )}

        {/* Tab 2: Placement Questions & Scenarios */}
        {activeTab === 'questions' && (
          <div className="questions-section animate-fade-in">
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
