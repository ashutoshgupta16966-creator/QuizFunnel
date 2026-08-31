import { useState, useEffect } from 'react';
import { getQuizReview } from '../api';

export default function ReviewSection({ mobile }) {
  const [reviewData, setReviewData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeLevelTab, setActiveLevelTab] = useState('all'); // 'all' | 1 | 2 | 3 | 4

  useEffect(() => {
    if (!mobile) return;
    let isMounted = true;

    const fetchReview = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await getQuizReview(mobile);
        if (isMounted) {
          setReviewData(res.data.data || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.response?.data?.error || 'Failed to load detailed question review.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchReview();
    return () => { isMounted = false; };
  }, [mobile]);

  if (!mobile) return null;

  // Filter out unattempted questions and unreached levels with 0 attempted questions
  const attemptedLevels = (reviewData || [])
    .map((lvl) => ({
      ...lvl,
      questions: (lvl.questions || []).filter(
        (q) => !q.isUnattempted && q.selectedOptionIndex !== null && q.selectedOptionIndex !== undefined && q.selectedOptionIndex !== -1
      ),
    }))
    .filter((lvl) => lvl.questions.length > 0);

  const filteredLevels = activeLevelTab === 'all'
    ? attemptedLevels
    : attemptedLevels.filter((l) => l.level === Number(activeLevelTab));

  const allQuestions = attemptedLevels.flatMap((lvl) =>
    lvl.questions.map((q) => ({ ...q, levelNum: lvl.level }))
  );

  const totalAttempted = allQuestions.length;
  const totalCorrect = allQuestions.filter((q) => q.isCorrect).length;
  const totalIncorrect = allQuestions.filter((q) => !q.isCorrect).length;

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
                      Level {lvl.level} ({lvl.questions.length})
                    </button>
                  ))}
                </div>
              )}

              {/* Questions List */}
              <div className="review-questions-list">
                {filteredLevels.map((lvl) => (
                  <div key={lvl.level} className="review-level-group">
                    {activeLevelTab === 'all' && allLevels.length > 1 && (
                      <div className="review-level-header">
                        <h4>Level {lvl.level} Performance ({lvl.score}/{lvl.questions.length} pts)</h4>
                      </div>
                    )}

                    {lvl.questions.map((q, idx) => (
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
                            <span className="review-q-section">{q.section}</span>
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
                        <p className="review-q-text">{q.questionText}</p>

                        {/* 4 Options Grid */}
                        <div className="review-options-grid">
                          {q.options.map((optText, optIdx) => {
                            const isCorrectOpt = optIdx === q.correctAnswerIndex;
                            const isChosenOpt = optIdx === q.selectedOptionIndex;

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
                        </div>
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
