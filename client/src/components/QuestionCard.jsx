import { useEffect, useRef } from 'react';

/**
 * Ripple effect helper — adds a ripple element to the target element on click.
 */
function createRipple(event) {
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

const LETTER_LABELS = ['A', 'B', 'C', 'D'];

/**
 * QuestionCard
 * Props:
 *   question      — { _id, questionText, section, options: string[] }
 *   selectedIndex — currently selected option index (null if none)
 *   onAnswer      — (index: number) => void
 *   questionNumber — display number (1-based)
 */
export default function QuestionCard({ question, selectedIndex, onAnswer, questionNumber }) {
  const cardRef = useRef(null);

  // Slide-in animation resets when question changes
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.animation = 'none';
    // Force reflow
    void card.offsetHeight;
    card.style.animation = '';
  }, [question._id]);

  const handleOptionClick = (e, idx) => {
    if (selectedIndex !== null) return; // already answered
    createRipple(e);
    onAnswer(idx);
  };

  // Format multi-line question text (Level 4 code questions use \n)
  const lines = question.questionText.split('\n');

  return (
    <div className="question-wrapper" ref={cardRef}>
      <div className="question-meta">
        <span className="question-number">Q{questionNumber}</span>
        <span className="question-section-tag">{question.section}</span>
      </div>

      <div className="question-text">
        {lines.length === 1 ? (
          lines[0]
        ) : (
          <>
            <p>{lines[0]}</p>
            <pre className="code-block">{lines.slice(1).join('\n')}</pre>
          </>
        )}
      </div>

      <div className="options-grid">
        {question.options.map((option, idx) => {
          const isSelected = selectedIndex === idx;
          return (
            <button
              key={idx}
              className={`option-btn${isSelected ? ' option-selected' : ''}`}
              onClick={(e) => handleOptionClick(e, idx)}
              disabled={selectedIndex !== null && !isSelected}
              aria-pressed={isSelected}
            >
              <span className="option-letter">{LETTER_LABELS[idx]}</span>
              <span className="option-text">{option}</span>
              {isSelected && <span className="option-check" aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
