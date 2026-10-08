import { useState, useEffect } from 'react';
import { getQuizReview } from '../api';

export default function ReviewSection({ mobile, totalQuestions }) {
  const [reviewData, setReviewData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeLevelTab, setActiveLevelTab] = useState('all'); // 'all' | 1 | 2 | 3 | 4

  useEffect(() => {
    if (!mobile) return;
    let isMounted = true;
    let retryTimer = null;

    const fetchReview = async (isRetry = false) => {
      try {
        if (!isRetry) setLoading(true);
        setError('');
        const res = await getQuizReview(mobile);
        const data = res.data.data || [];
        if (isMounted) {
          setReviewData(data);
          // If first fetch returned no data (possible race: submit DB write still in progress),
          // schedule one retry after 2 seconds.
          if (!isRetry && data.length === 0) {
            retryTimer = setTimeout(() => {
              if (isMounted) fetchReview(true);
            }, 2000);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.response?.data?.error || 'Failed to load detailed question review.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // Small initial delay: the Results page renders immediately after navigation from /submit,
    // but the MongoDB write (Student.updateOne) may not yet be fully persisted.
    // A 1-second delay ensures the review endpoint reads the committed data.
    const initialTimer = setTimeout(() => {
      if (isMounted) fetchReview();
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [mobile]);

  if (!mobile) return null;

  // Only include levels that actually have questions recorded for this candidate
  const attemptedLevels = (reviewData || []).filter(
    (lvl) => Array.isArray(lvl.questions) && lvl.questions.length > 0
  );

  const filteredLevels = activeLevelTab === 'all'
    ? attemptedLevels
    : attemptedLevels.filter((l) => l.level === Number(activeLevelTab));

  const allQuestions = attemptedLevels.flatMap((lvl) =>
    (lvl.questions || []).map((q) => ({ ...q, levelNum: lvl.level }))
  );

  const isQuestionAttempted = (q) => {
    if (q.questionType === 'direct') {
      return Boolean(q.directUserAnswer || q.selectedOptionText);
    }
    return !q.isUnattempted && (
      (q.selectedOptionIndex !== null && q.selectedOptionIndex !== undefined && q.selectedOptionIndex !== -1) ||
      Boolean(q.selectedOptionText)
    );
  };

  const totalAttempted = allQuestions.filter(isQuestionAttempted).length;
  const totalCorrect = allQuestions.filter((q) => q.isCorrect).length;
  const totalIncorrect = allQuestions.filter((q) => !q.isCorrect && isQuestionAttempted(q)).length;
  const overallTotal = Number(totalQuestions) > 0 ? Number(totalQuestions) : allQuestions.length;

  return (
    <div className="review-section-wrapper">
      {/* Accordion Toggle Header */}
      <button
        type="button"
        className="review-accordion-toggle"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <div className="review-toggle-left">
          <span className="review-toggle-icon">📝</span>
          <div className="review-toggle-titles">
            <h3 className="review-toggle-title">Review Detailed Answers</h3>
            <p className="review-toggle-subtitle">
              Inspect all attempted questions and check your answers
            </p>
          </div>
        </div>
        <span className={`review-chevron ${isExpanded ? 'open' : ''}`}>▼</span>
      </button>

      {/* Accordion Body */}
      {isExpanded && (
        <div className="review-content-body">
          {loading && (
            <div className="review-loading-state">
              <div className="spinner" />
              <p>Loading your detailed answer review…</p>
            </div>
          )}

          {error && (
            <div className="review-error-state">
              <p>⚠️ {error}</p>
            </div>
          )}

          {!loading && !error && allQuestions.length === 0 && (
            <div className="review-empty-state">
              <p>No attempted questions found to review for this session.</p>
            </div>
          )}

          {!loading && !error && allQuestions.length > 0 && (
            <>
              {/* Quick Metrics Bar */}
              <div className="review-metrics-strip">
                <div className="review-metric-pill overall-total">
                  <span className="metric-pill-label">📋 Total Questions:</span>
                  <span className="metric-pill-value">{overallTotal}</span>
                </div>
                <div className="review-metric-pill total">
                  <span className="metric-pill-label">Total Attempted:</span>
                  <span className="metric-pill-value">{totalAttempted}</span>
                </div>
                <div className="review-metric-pill correct">
                  <span className="metric-pill-label">✅ Correct:</span>
                  <span className="metric-pill-value">{totalCorrect}</span>
                </div>
                <div className="review-metric-pill incorrect">
                  <span className="metric-pill-label">❌ Incorrect:</span>
                  <span className="metric-pill-value">{totalIncorrect}</span>
                </div>
              </div>

              {/* Level Filter Tabs (if multiple levels attempted) */}
              {attemptedLevels.length > 1 && (
                <div className="review-level-tabs">
                  <button
                    type="button"
                    className={`review-tab-btn ${activeLevelTab === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveLevelTab('all')}
                  >
                    All Attempted ({totalAttempted})
                  </button>
                  {attemptedLevels.map((lvl) => (
                    <button
                      key={lvl.level}
                      type="button"
                      className={`review-tab-btn ${activeLevelTab === lvl.level ? 'active' : ''}`}
                      onClick={() => setActiveLevelTab(lvl.level)}
                    >
                      Level {lvl.level} ({(lvl.questions || []).length})
                    </button>
                  ))}
                </div>
              )}

              {/* Questions List */}
              <div className="review-questions-list">
                {filteredLevels.map((lvl) => (
                  <div key={lvl.level} className="review-level-group">
                    {activeLevelTab === 'all' && attemptedLevels.length > 1 && (
                      <div className="review-level-header">
                        <h4>Level {lvl.level} Performance ({lvl.score ?? 0}/{(lvl.questions || []).length} pts)</h4>
                      </div>
                    )}

                    {(lvl.questions || []).map((q, idx) => (
                      <div
                        key={q.questionId || idx}
                        className={`review-question-card ${
                          q.isCorrect
                            ? 'is-correct-card'
                            : q.isUnattempted
                            ? 'is-unattempted-card'
                            : 'is-wrong-card'
                        }`}
                      >
                        {/* Question Card Top Header */}
                        <div className="review-q-header">
                          <div className="review-q-meta">
                            <span className="review-q-num">Q{idx + 1}</span>
                            <span className="review-q-section">{q.section || 'General'}</span>
                            <span className="review-q-difficulty">{q.difficulty || 'medium'}</span>
                          </div>

                          <div className="review-q-status">
                            {q.isCorrect && (
                              <span className="status-badge-correct">✅ Correct (+1)</span>
                            )}
                            {!q.isCorrect && !q.isUnattempted && (
                              <span className="status-badge-wrong">❌ Incorrect (0)</span>
                            )}
                            {q.isUnattempted && (
                              <span className="status-badge-unattempted">⚪ Unattempted</span>
                            )}
                          </div>
                        </div>

                        {/* Question Text */}
                        <p className="review-q-text">{q.questionText || 'Question'}</p>

                        {/* Options Grid (MCQ) or Direct Answer Display */}
                        {q.questionType === 'direct' ? (
                          <div className="review-direct-answer-block" style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.86rem' }}>
                            <div>
                              <strong style={{ color: '#94a3b8' }}>Your Answer: </strong>
                              <span style={{ color: q.isCorrect ? '#34d399' : (q.isUnattempted ? '#94a3b8' : '#f87171') }}>
                                {q.directUserAnswer || q.selectedOptionText || '(not answered)'}
                              </span>
                            </div>
                            {!q.isCorrect && (
                              <div>
                                <strong style={{ color: '#34d399' }}>Correct Answer: </strong>
                                <span style={{ color: '#34d399' }}>{q.directAnswer || q.correctAnswerText || '—'}</span>
                              </div>
                            )}
                            {q.explanation && (
                              <div style={{ marginTop: '0.35rem', padding: '0.45rem 0.65rem', background: 'rgba(99,102,241,0.1)', borderRadius: '6px', color: '#a5b4fc', fontSize: '0.8rem' }}>
                                💡 {q.explanation}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="review-options-grid">
                            {(q.options || []).map((optText, optIdx) => {
                              const cleanNorm = (str) => String(str || '').toLowerCase().replace(/^([a-d1-4][.:)]|\([a-d1-4]\))\s*/i, '').trim();
                              const isMatchByText = Boolean(q.selectedOptionText && optText && cleanNorm(optText) === cleanNorm(q.selectedOptionText));
                              const isChosenOpt = optIdx === q.selectedOptionIndex || isMatchByText;

                              const isCorrectByText = Boolean(q.correctAnswerText && optText && cleanNorm(optText) === cleanNorm(q.correctAnswerText));
                              const isCorrectOpt = optIdx === q.correctAnswerIndex || isCorrectByText;

                              let optionStateClass = 'option-neutral';
                              let badgeLabel = null;

                              if (isCorrectOpt && isChosenOpt) {
                                optionStateClass = 'option-correct-chosen';
                                badgeLabel = '✅ Your Answer (Correct)';
                              } else if (isCorrectOpt) {
                                optionStateClass = 'option-correct-answer';
                                badgeLabel = '✅ Correct Answer';
                              } else if (isChosenOpt) {
                                optionStateClass = 'option-wrong-chosen';
                                badgeLabel = '❌ Your Choice (Incorrect)';
                              }

                              return (
                                <div
                                  key={optIdx}
                                  className={`review-option-item ${optionStateClass}`}
                                >
                                  <span className="option-prefix">
                                    {String.fromCharCode(65 + optIdx)}.
                                  </span>
                                  <span className="option-content-text">{optText}</span>
                                  {badgeLabel && (
                                    <span className="option-indicator-tag">{badgeLabel}</span>
                                  )}
                                </div>
                              );
                            })}
                            {q.explanation && (
                              <div style={{ marginTop: '0.45rem', padding: '0.45rem 0.65rem', background: 'rgba(99,102,241,0.1)', borderRadius: '6px', color: '#a5b4fc', fontSize: '0.8rem', gridColumn: '1 / -1' }}>
                                💡 {q.explanation}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
