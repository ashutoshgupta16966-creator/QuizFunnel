import { useState, useEffect } from 'react';
import { getQuizReview, submitFeedback, getAttemptFeedback } from '../api';

function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function AttemptDetailView({ attemptDetail, studentData, onBack }) {
  const mobile = attemptDetail?.mobile || studentData?.mobile;
  const attemptId = attemptDetail?._id || attemptDetail?.id || attemptDetail?.attemptId || `attempt_${mobile}_${attemptDetail?.clearedLvl}`;

  // ── Level Accordion State ────────────────────────────────────────────────
  const [expandedLevels, setExpandedLevels] = useState(() => {
    // Default open first level
    return { 1: true };
  });

  const toggleLevel = (lvlNum) => {
    setExpandedLevels((prev) => ({
      ...prev,
      [lvlNum]: !prev[lvlNum],
    }));
  };

  // ── Detailed Review Questions Fetching ──────────────────────────────────
  const [reviewData, setReviewData] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');

  useEffect(() => {
    if (!mobile) return;
    let isMounted = true;

    const loadReview = async () => {
      try {
        setReviewLoading(true);
        setReviewError('');
        const res = await getQuizReview(mobile);
        if (isMounted) {
          setReviewData(res.data.data || []);
        }
      } catch (err) {
        if (isMounted) {
          setReviewError(err.response?.data?.error || 'Could not load detailed performance review.');
        }
      } finally {
        if (isMounted) setReviewLoading(false);
      }
    };

    loadReview();
    return () => { isMounted = false; };
  }, [mobile]);

  // ── Feedback State (Immutable) ───────────────────────────────────────────
  const [feedback, setFeedback] = useState(null);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackHoverRating, setFeedbackHoverRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Load existing feedback for this attempt
  useEffect(() => {
    if (!attemptId) return;
    let isMounted = true;

    const loadFeedback = async () => {
      try {
        const res = await getAttemptFeedback(attemptId, mobile);
        if (isMounted && res.data.data) {
          setFeedback(res.data.data);
        }
      } catch { /* noop */ }
    };

    loadFeedback();
    return () => { isMounted = false; };
  }, [attemptId, mobile]);

  const handleSubmitFeedback = async (e) => {
    e.preventDefault();
    if (feedback || feedbackSubmitting) return; // Immutable check

    try {
      setFeedbackSubmitting(true);
      setFeedbackMsg('');
      const res = await submitFeedback({
        mobile,
        attemptId,
        rating: feedbackRating,
        comment: feedbackComment.trim(),
      });

      setFeedback(res.data.data);
      setFeedbackMsg('Thank you! Your feedback has been recorded permanently.');
    } catch (err) {
      setFeedbackMsg(err.response?.data?.error || 'Failed to submit feedback. Try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const isDisqualified = Boolean(attemptDetail.isDisqualified || attemptDetail.status === 'disqualified');
  const isCompleted = !isDisqualified && attemptDetail.status === 'completed';
  const isRoomAttempt = Boolean(attemptDetail.isRoom || attemptDetail.quizType === 'room');
  const roomCode = attemptDetail.roomCode || '';

  // Map review data by level for fast lookup (filtering only attempted questions)
  const reviewMapByLevel = {};
  reviewData.forEach((lvl) => {
    const attemptedQs = (lvl.questions || []).filter(
      (q) => !q.isUnattempted && q.selectedOptionIndex !== null && q.selectedOptionIndex !== undefined && q.selectedOptionIndex !== -1
    );
    reviewMapByLevel[lvl.level] = attemptedQs;
  });

  // Only show levels actually reached / attempted in this run
  const summaryMap = {};
  if (attemptDetail.levelsSummary && attemptDetail.levelsSummary.length > 0) {
    attemptDetail.levelsSummary.forEach((lvl) => {
      summaryMap[lvl.level] = lvl;
    });
  } else if (attemptDetail.clearedLvl) {
    summaryMap[attemptDetail.clearedLvl] = {
      level: attemptDetail.clearedLvl,
      score: attemptDetail.score,
      timeTaken: attemptDetail.timeSecs,
    };
  }

  // Filter levelsList to only rendered levels that were actually attempted
  const levelsList = Object.keys(summaryMap).length > 0
    ? Object.values(summaryMap).sort((a, b) => a.level - b.level)
    : [1, 2, 3, 4]
        .filter((n) => (reviewMapByLevel[n] && reviewMapByLevel[n].length > 0))
        .map((n) => ({ level: n, score: attemptDetail.score || 0, timeTaken: attemptDetail.timeSecs || 0 }));

  return (
    <div className="attempt-detail-view">
      {/* Top Header */}
      <div className="detail-view-header">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onBack}
        >
          ← Back to History List
        </button>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isRoomAttempt && (
            <span className="status-badge room-badge">
              Room Quiz 🏫 {roomCode ? `(${roomCode})` : ''}
            </span>
          )}
          <span className={`status-badge ${isDisqualified ? 'disqualified' : isCompleted ? 'completed' : 'eliminated'}`}>
            {isDisqualified ? 'Disqualified 🚫' : isCompleted ? 'Completed' : 'Eliminated'}
          </span>
        </div>
      </div>

      {/* Hero Summary Card */}
      <div className={`detail-hero-card ${isDisqualified ? 'is-disqualified-hero' : ''}`}>
        <div className="detail-hero-icon">
          {isDisqualified ? '🚨' : isCompleted ? '🏆' : '⚡'}
        </div>
        <h3 className="detail-hero-title">
          {isDisqualified
            ? 'Assessment Terminated & Disqualified'
            : isCompleted
            ? 'Quiz Completed Successfully!'
            : `Attempt Ended at Level ${attemptDetail.clearedLvl}`}
        </h3>
        {isDisqualified && (
          <p style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.875rem', marginTop: '0.35rem' }}>
            ⚠️ Terminated due to exceeding the maximum allowed limit of 10 tab switches.
          </p>
        )}
        <p className="detail-hero-meta">
          {isRoomAttempt && (
            <span style={{ color: '#a78bfa', fontWeight: 700 }}>[Room: {roomCode}] · </span>
          )}
          {studentData?.name || attemptDetail.studentName} ({studentData?.branch || attemptDetail.branch}) ·{' '}
          {attemptDetail.attemptDate
            ? new Date(attemptDetail.attemptDate).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : 'Recent Attempt'}
        </p>
      </div>

      {/* Performance Metrics Grid */}
      <div className="detail-metrics-grid">
        <div className="detail-metric-card">
          <span className="detail-metric-label">Level Reached</span>
          <span className="detail-metric-val">Level {attemptDetail.clearedLvl} of 4</span>
        </div>
        <div className="detail-metric-card">
          <span className="detail-metric-label">Total Score (All Levels)</span>
          <span className="detail-metric-val">{attemptDetail.score} / {attemptDetail.maxPoss}</span>
        </div>
        <div className="detail-metric-card">
          <span className="detail-metric-label">Accuracy Rate</span>
          <span className="detail-metric-val">{attemptDetail.accuracy}%</span>
        </div>
        <div className="detail-metric-card">
          <span className="detail-metric-label">Total Time Taken</span>
          <span className="detail-metric-val">{formatTimeMMSS(attemptDetail.timeSecs)}</span>
        </div>
      </div>

      {/* ── Interactive Level-by-Level Breakdown ── */}
      <div className="detail-breakdown-card">
        <h4 className="breakdown-title">📋 Level-by-Level Performance Breakdown</h4>
        <p className="breakdown-subtitle">
          Click any level to expand and review attempted questions.
        </p>

        {reviewLoading && (
          <div className="level-review-loading">
            <div className="spinner" />
            <span>Loading question details…</span>
          </div>
        )}

        {reviewError && (
          <div className="level-review-error">
            <span>⚠️ {reviewError}</span>
          </div>
        )}

        <div className="level-accordion-container">
          {levelsList.map((lvlItem) => {
            const lvlNum = lvlItem.level;
            const isOpen = !!expandedLevels[lvlNum];
            const lvlQuestions = reviewMapByLevel[lvlNum] || [];
            const notPlayed = lvlItem.score === null && lvlItem.timeTaken === null;

            return (
              <div key={lvlNum} className={`level-accordion-item ${isOpen ? 'is-open' : ''} ${notPlayed ? 'not-played' : ''}`}>
                {/* Level Row Header (Clickable Accordion) */}
                <button
                  type="button"
                  className="level-accordion-header"
                  onClick={() => toggleLevel(lvlNum)}
                  aria-expanded={isOpen}
                >
                  <div className="level-header-left">
                    <span className="level-indicator-pill">Level {lvlNum}</span>
                    {notPlayed ? (
                      <span className="level-header-not-played">Not reached</span>
                    ) : (
                      <>
                        <span className="level-header-score">
                          Score: <strong>{lvlItem.score ?? 0} pts</strong>
                        </span>
                        <span className="level-header-time">
                          ⏱️ {formatTimeMMSS(lvlItem.timeTaken || 0)}
                        </span>
                      </>
                    )}
                  </div>
                  <span className={`level-header-chevron ${isOpen ? 'open' : ''}`}>▼</span>
                </button>

                {/* Level Questions */}
                {isOpen && (
                  <div className="level-accordion-body">
                    {notPlayed ? (
                      <div className="level-questions-empty">
                        <p>This level was not reached in this attempt.</p>
                      </div>
                    ) : lvlQuestions.length === 0 ? (
                      <div className="level-questions-empty">
                        <p>No questions recorded for Level {lvlNum}.</p>
                      </div>
                    ) : (
                      <div className="level-questions-list">
                        {lvlQuestions.map((q, qIndex) => {
                          const isCorrect = q.isCorrect;
                          const isUnattempted = q.isUnattempted;

                          return (
                            <div
                              key={q.questionId || qIndex}
                              className={`level-question-card ${
                                isCorrect
                                  ? 'card-correct'
                                  : isUnattempted
                                  ? 'card-unattempted'
                                  : 'card-wrong'
                              }`}
                            >
                              {/* Question Top Bar */}
                              <div className="qcard-top-bar">
                                <div className="qcard-meta">
                                  <span className="qcard-num">Q{qIndex + 1}</span>
                                  <span className="qcard-section">{q.section}</span>
                                </div>
                                <div className="qcard-status">
                                  {isCorrect && (
                                    <span className="qstatus-pill correct">✅ Correct (+1)</span>
                                  )}
                                  {!isCorrect && !isUnattempted && (
                                    <span className="qstatus-pill wrong">❌ Incorrect (0)</span>
                                  )}
                                  {isUnattempted && (
                                    <span className="qstatus-pill unattempted">⚪ Unattempted</span>
                                  )}
                                </div>
                              </div>

                              {/* Question Text */}
                              <p className="qcard-text">{q.questionText}</p>

                              {/* 4 Options Grid */}
                              <div className="qcard-options-grid">
                                {q.options.map((optText, optIdx) => {
                                  const isCorrectOpt = optIdx === q.correctAnswerIndex;
                                  const isChosenOpt = optIdx === q.selectedOptionIndex;

                                  let optClass = 'opt-neutral';
                                  let tagText = null;

                                  if (isCorrectOpt && isChosenOpt) {
                                    optClass = 'opt-correct-chosen';
                                    tagText = '✅ Your Choice (Correct)';
                                  } else if (isCorrectOpt) {
                                    optClass = 'opt-correct';
                                    tagText = '✅ Correct Answer';
                                  } else if (isChosenOpt) {
                                    optClass = 'opt-wrong-chosen';
                                    tagText = '❌ Your Choice (Incorrect)';
                                  }

                                  return (
                                    <div key={optIdx} className={`qcard-option-item ${optClass}`}>
                                      <span className="opt-prefix">{String.fromCharCode(65 + optIdx)}.</span>
                                      <span className="opt-text">{optText}</span>
                                      {tagText && <span className="opt-tag">{tagText}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── IMMUTABLE FEEDBACK / EXPERIENCE REVIEW SECTION ── */}
      <div className="detail-feedback-card">
        <h4 className="feedback-title">🌟 Experience Feedback &amp; Review</h4>

        {feedback ? (
          /* Locked / Immutable Feedback Display */
          <div className="feedback-locked-view">
            <div className="feedback-locked-header">
              <span className="feedback-badge-locked">🔒 Feedback Recorded (Immutable)</span>
              <span className="feedback-stars-locked">
                {'★'.repeat(feedback.rating)}
                {'☆'.repeat(5 - feedback.rating)}
                <span className="rating-num"> ({feedback.rating}/5)</span>
              </span>
            </div>
            {feedback.comment ? (
              <p className="feedback-comment-locked">"{feedback.comment}"</p>
            ) : (
              <p className="feedback-comment-empty">No written comment provided.</p>
            )}
            <p className="feedback-locked-note">
              Submitted on {new Date(feedback.submittedAt || feedback.createdAt).toLocaleDateString(undefined, {
                dateStyle: 'medium',
              })}. Feedback is permanently attached to this attempt.
            </p>
          </div>
        ) : (
          /* Interactive Feedback Form */
          <form onSubmit={handleSubmitFeedback} className="feedback-form">
            <p className="feedback-prompt">
              How was your experience taking this quiz attempt? Your feedback helps us improve!
            </p>

            <div className="feedback-rating-row">
              <span className="rating-label">Rating:</span>
              <div className="star-rating-controls" role="radiogroup" aria-label="5 star rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-btn ${
                      star <= (feedbackHoverRating || feedbackRating) ? 'filled' : ''
                    }`}
                    onClick={() => setFeedbackRating(star)}
                    onMouseEnter={() => setFeedbackHoverRating(star)}
                    onMouseLeave={() => setFeedbackHoverRating(0)}
                    aria-label={`${star} star`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <span className="rating-value-badge">{feedbackRating}/5 Stars</span>
            </div>

            <div className="form-group">
              <label className="form-label">Comments / Experience Review (Optional)</label>
              <textarea
                className="form-input feedback-textarea"
                rows={3}
                placeholder="Share your thoughts about question difficulty, test experience, or suggestions..."
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                maxLength={500}
              />
            </div>

            {feedbackMsg && (
              <div className="feedback-status-msg">{feedbackMsg}</div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-submit-feedback"
              disabled={feedbackSubmitting}
            >
              {feedbackSubmitting ? <><span className="btn-spinner" /> Submitting…</> : 'Submit Feedback ✓'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
