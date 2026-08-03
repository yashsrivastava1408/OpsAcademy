import { useState } from 'react';
import { CheckCircle2, XCircle, HelpCircle, Sparkles, RefreshCw } from 'lucide-react';
import './Quiz.css';

export default function Quiz({ quiz }) {
  const [selectedOption, setSelectedOption] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  if (!quiz) return null;

  const isCorrect = selectedOption === quiz.correctIndex;

  const handleSubmit = (index) => {
    if (submitted) return;
    setSelectedOption(index);
    setSubmitted(true);
  };

  const handleReset = () => {
    setSelectedOption(null);
    setSubmitted(false);
  };

  return (
    <div className={`quiz-card glass-card ${submitted ? (isCorrect ? 'quiz-pass-glow' : 'quiz-fail-glow') : ''}`}>
      <div className="quiz-header">
        <div className="quiz-title-area">
          <HelpCircle size={18} className="quiz-icon" />
          <span className="quiz-badge">Concept Check</span>
        </div>
        {submitted && isCorrect && (
          <span className="quiz-score-badge">
            <Sparkles size={12} /> Passed +25 XP
          </span>
        )}
      </div>

      <h4 className="quiz-question">{quiz.question}</h4>

      <div className="quiz-options stagger-children">
        {quiz.options.map((option, idx) => {
          let btnClass = 'quiz-option-btn';
          if (submitted) {
            if (idx === quiz.correctIndex) {
              btnClass += ' correct animate-scale-in';
            } else if (idx === selectedOption) {
              btnClass += ' incorrect';
            }
          }

          return (
            <button
              key={idx}
              className={btnClass}
              onClick={() => handleSubmit(idx)}
              disabled={submitted}
            >
              <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
              <span className="option-text">{option}</span>
              {submitted && idx === quiz.correctIndex && <CheckCircle2 size={16} className="status-icon" />}
              {submitted && idx === selectedOption && idx !== quiz.correctIndex && (
                <XCircle size={16} className="status-icon" />
              )}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div className={`quiz-explanation ${isCorrect ? 'pass' : 'fail'} animate-fade-in-up`}>
          <div className="explanation-title">
            {isCorrect ? '🎉 Correct Answer!' : '❌ Not Quite Right'}
          </div>
          <p>{quiz.explanation}</p>
          {!isCorrect && (
            <button className="btn btn-ghost btn-sm reset-btn" onClick={handleReset}>
              <RefreshCw size={14} /> Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
