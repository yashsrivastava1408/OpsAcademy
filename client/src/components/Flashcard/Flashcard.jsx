import { useState } from 'react';
import { RotateCw, Sparkles } from 'lucide-react';
import './Flashcard.css';

export default function Flashcard({ card }) {
  const [isFlipped, setIsFlipped] = useState(false);

  if (!card) return null;

  return (
    <div className="flashcard-container" onClick={() => setIsFlipped(!isFlipped)}>
      <div className={`flashcard ${isFlipped ? 'flipped' : ''}`}>
        {/* Front */}
        <div className="flashcard-face flashcard-front glass-card">
          <div className="flashcard-header">
            <span className="flashcard-badge">Question</span>
            <RotateCw size={14} className="flip-hint-icon" />
          </div>
          <div className="flashcard-content">
            <h3>{card.front}</h3>
          </div>
          <div className="flashcard-footer">
            <span>Click card to reveal answer</span>
          </div>
        </div>

        {/* Back */}
        <div className="flashcard-face flashcard-back glass-card">
          <div className="flashcard-header">
            <span className="flashcard-badge answer">
              <Sparkles size={12} /> Answer
            </span>
            <RotateCw size={14} className="flip-hint-icon" />
          </div>
          <div className="flashcard-content">
            <p>{card.back}</p>
          </div>
          <div className="flashcard-footer">
            <span>Click to flip back</span>
          </div>
        </div>
      </div>
    </div>
  );
}
