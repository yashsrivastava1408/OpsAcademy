import { useState } from 'react';
import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
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
    <div className="quiz-card glass-card">
      <div className="quiz-header">
        <HelpCircle size={18} className="quiz-icon" />
        <span className="quiz-badge">Concept Check</span>
      </div>

      <h4 className="quiz-question">{quiz.question}</h4>

      <div className="quiz-options">
        {quiz.options.map((option, idx) => {
          let btnClass = 'quiz-option-btn';
          if (submitted) {
            if (idx === quiz.correctIndex) {
              btnClass += ' correct';
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
        <div className={`quiz-explanation ${isCorrect ? 'pass' : 'fail'}`}>
          <div className="explanation-title">
            {isCorrect ? 'Correct! 🎉' : 'Not quite right'}
          </div>
          <p>{quiz.explanation}</p>
          {!isCorrect && (
            <button className="btn btn-ghost btn-sm reset-btn" onClick={handleReset}>
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
