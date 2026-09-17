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

function formatOptionText(option, idx) {
  if (!option || typeof option !== 'string') return `Choice ${LETTER_LABELS[idx] || idx + 1}`;
  const trimmed = option.trim();
  const cleaned = trimmed.replace(/^(\(?[a-dA-D1-4]\)?\s*[:.)-]\s*|^option\s*[a-dA-D1-4]\s*[:.)-]\s*)/i, '').trim();
  if (!cleaned || /^(option|choice)\s*[a-d1-4]?$/i.test(cleaned) || /^[a-d][.)]?$/i.test(cleaned)) {
    const contextualFallbacks = ['True', 'False', 'Cannot be determined', 'None of the above'];
    return contextualFallbacks[idx] || `Choice ${LETTER_LABELS[idx] || idx + 1}`;
  }
  return cleaned;
}

/**
 * QuestionCard
 * Props:
 *   question       — { _id, questionText, section, options: string[] }
 *   selectedIndex  — currently selected option index (null if none)
 *   onAnswer       — (index: number | null) => void
 *   questionNumber — display number (1-based)
 */
export default function QuestionCard({
  question,
  selectedIndex,
  onAnswer,
  questionNumber,
  isBookmarked = false,
  onToggleBookmark,
}) {
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

  const isDirect = question.questionType === 'direct' || (!question.options || question.options.length === 0);
  const directValue = typeof selectedIndex === 'string' ? selectedIndex : (selectedIndex !== null && selectedIndex !== undefined ? String(selectedIndex) : '');
  const hasAnswer = isDirect ? Boolean(directValue && directValue.trim()) : (selectedIndex !== null && selectedIndex !== undefined);

  const handleOptionClick = (e, idx) => {
    createRipple(e);
    // If clicking the currently selected option, toggle off / clear selection
    if (selectedIndex === idx) {
      onAnswer(null);
    } else {
      // Select or change choice
      onAnswer(idx);
    }
  };

  const handleClearSelection = () => {
    onAnswer(null);
  };

  // Format multi-line question text (Level 4 code questions use \n)
  const lines = (question.questionText || '').split('\n');

  return (
    <div className="question-wrapper" ref={cardRef}>
      <div className="question-meta">
        <div className="question-meta-left">
          <span className="question-number">Q{questionNumber}</span>
          <span className="question-section-tag">{question.section}</span>
          {isDirect && <span className="question-type-badge">Direct Answer</span>}
        </div>

        <div className="question-meta-right">
          {/* Bookmark / Save for Later ribbon */}
          <button
            type="button"
            className={`bookmark-ribbon-btn ${isBookmarked ? 'is-bookmarked' : ''}`}
            onClick={() => onToggleBookmark && onToggleBookmark(question._id)}
            title={isBookmarked ? 'Question Bookmarked — click to unmark' : 'Bookmark / Save for Later'}
            aria-pressed={isBookmarked}
          >
            <span className="bookmark-icon">🔖</span>
            <span className="bookmark-label">{isBookmarked ? 'Bookmarked' : 'Bookmark'}</span>
          </button>

          {hasAnswer && (
            <button
              type="button"
              className="clear-choice-btn"
              onClick={handleClearSelection}
              title="Clear answer for this question"
            >
              ✕ Clear Answer
            </button>
          )}
        </div>
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

      {isDirect ? (
        <div className="direct-answer-container">
          <label className="direct-answer-label">
            Type Your Answer:
          </label>
          <input
            type="text"
            className="form-input direct-answer-input"
            placeholder="Type your answer here..."
            value={directValue}
            onChange={(e) => onAnswer(e.target.value)}
            autoFocus
          />
          <p className="direct-answer-tip">
            💡 Letter casing and extra spaces are ignored during automatic grading.
          </p>
        </div>
      ) : (
        <div className="options-grid">
          {(question.options || []).map((option, idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <button
                key={idx}
                type="button"
                className={`option-btn${isSelected ? ' option-selected' : ''}`}
                onClick={(e) => handleOptionClick(e, idx)}
                aria-pressed={isSelected}
              >
                <span className="option-letter">{LETTER_LABELS[idx]}</span>
                <span className="option-text">{formatOptionText(option, idx)}</span>
                {isSelected && <span className="option-check" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {hasAnswer && (
        <div className="card-footer-actions">
          <button
            type="button"
            className="clear-selection-link"
            onClick={handleClearSelection}
          >
            ↺ Clear Answer
          </button>
        </div>
      )}
    </div>
  );
}
