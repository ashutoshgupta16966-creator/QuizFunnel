export default function QuestionPalette({
  questions = [],
  currentIndex = 0,
  answers = {},
  bookmarks = {},
  onSelectQuestion,
}) {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="question-palette-container" aria-label="Question Palette Navigator">
      <div className="palette-header-row">
        <span className="palette-title">📊 Question Palette</span>
        <div className="palette-legend">
          <span className="legend-item"><span className="legend-dot answered" /> Answered</span>
          <span className="legend-item"><span className="legend-dot bookmarked" /> Bookmarked</span>
          <span className="legend-item"><span className="legend-dot unanswered" /> Unanswered</span>
          <span className="legend-item"><span className="legend-dot current" /> Current</span>
        </div>
      </div>

      <div className="palette-grid">
        {questions.map((q, idx) => {
          const isCurrent = idx === currentIndex;
          const isAnswered = answers[q._id] !== undefined && answers[q._id] !== -1;
          const isBookmarked = !!bookmarks[q._id];

          let statusClass = 'status-unanswered';
          if (isBookmarked) {
            statusClass = 'status-bookmarked';
          } else if (isAnswered) {
            statusClass = 'status-answered';
          }

          return (
            <button
              key={q._id || idx}
              type="button"
              className={`palette-tile ${statusClass} ${isCurrent ? 'is-current' : ''}`}
              onClick={() => onSelectQuestion(idx)}
              title={`Question ${idx + 1}${isBookmarked ? ' (Bookmarked)' : isAnswered ? ' (Answered)' : ' (Unanswered)'}`}
              aria-label={`Jump to Question ${idx + 1}`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <span className="tile-num">{idx + 1}</span>
              {isBookmarked && <span className="tile-bookmark-flag" aria-hidden>★</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
