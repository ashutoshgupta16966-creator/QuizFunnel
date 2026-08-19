import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerStudent } from '../api';
import { useQuiz } from '../context/QuizContext';
import { BRANCHES, LEVELS } from '../config';

const HISTORY_STORAGE_KEY = 'quiz_attempts_history';

export default function EntryForm() {
  const navigate = useNavigate();
  const { saveStudent } = useQuiz();

  const [form, setForm] = useState({ name: '', mobile: '', branch: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [history, setHistory] = useState([]);

  const handleOpenHistoryModal = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      setHistory(saved);
    } catch {
      setHistory([]);
    }
    setShowHistoryModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim())            e.name   = 'Full name is required.';
    if (!/^\d{10}$/.test(form.mobile)) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (!form.branch)                  e.branch = 'Please select your branch.';
    return e;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
    setServerError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      const res = await registerStudent({
        name:   form.name.trim(),
        mobile: form.mobile.trim(),
        branch: form.branch,
      });
      const student = res.data.data;
      saveStudent(student);

      // Backend always creates a fresh Level-1 attempt, so we simply
      // navigate the student straight into the quiz. No status checks needed.
      navigate(`/quiz/${student.currentLevel}`);
    } catch (err) {
      setServerError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="entry-page">
      {/* Sleek Top-Right "My Results" Badge */}
      <button
        type="button"
        className="my-results-btn"
        onClick={handleOpenHistoryModal}
        title="View your saved quiz attempts history"
      >
        🏆 <span className="btn-text">My Results</span>
      </button>

      <div className="entry-card">
        <div className="entry-logo" aria-hidden>🎓</div>
        <h1 className="entry-title">Quiz Funnel</h1>
        <p className="entry-subtitle">Fill in your details to begin the challenge</p>

        <form onSubmit={handleSubmit} noValidate>
          {/* Name */}
          <div className="form-group">
            <label className="form-label" htmlFor="name">Full Name</label>
            <input
              id="name" name="name" type="text"
              className={`form-input${errors.name ? ' form-input-error' : ''}`}
              placeholder="e.g. Ananya Sharma"
              value={form.name}
              onChange={handleChange}
              autoComplete="name"
              maxLength={80}
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>

          {/* Mobile */}
          <div className="form-group">
            <label className="form-label" htmlFor="mobile">Mobile Number</label>
            <input
              id="mobile" name="mobile" type="tel"
              className={`form-input${errors.mobile ? ' form-input-error' : ''}`}
              placeholder="10-digit number"
              value={form.mobile}
              onChange={handleChange}
              maxLength={10}
              inputMode="numeric"
              pattern="\d{10}"
            />
            {errors.mobile && <p className="form-error">{errors.mobile}</p>}
          </div>

          {/* Branch */}
          <div className="form-group">
            <label className="form-label" htmlFor="branch">Branch</label>
            <select
              id="branch" name="branch"
              className={`form-select${errors.branch ? ' form-input-error' : ''}`}
              value={form.branch}
              onChange={handleChange}
            >
              <option value="">Select your branch</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            {errors.branch && <p className="form-error">{errors.branch}</p>}
          </div>

          {/* No negative marking banner */}
          <div className="no-negative-banner" role="note">
            <span className="banner-icon" aria-hidden>🎯</span>
            <div className="banner-text">
              <strong>Note:</strong> There is <strong>NO negative marking!</strong> Make sure to attempt all questions.
            </div>
          </div>

          {serverError && (
            <div className="server-error" role="alert">{serverError}</div>
          )}

          <button
            type="submit"
            id="start-quiz-btn"
            className="btn btn-primary form-submit-btn"
            disabled={loading}
          >
            {loading ? <><span className="btn-spinner" />Checking…</> : 'Start the Quiz →'}
          </button>
        </form>

        {/* Quiz structure info */}
        <div className="level-info">
          <p className="level-info-title">⚡ 4 Levels · Elimination Style</p>
          <div className="level-chips">
            {Object.entries(LEVELS).map(([lvl, cfg]) => (
              <span key={lvl} className="level-chip">
                L{lvl}: {cfg.questions}Q · {Math.floor(cfg.timeSeconds / 60)}m
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Attribution Badge with Drop-Cap / Small-Caps Hierarchy */}
      <footer className="author-attribution-badge">
        <div className="cinematic-gold-branding">
          <span className="drop-cap">C</span>REATED <span className="small-word">BY</span> ~ <span className="drop-cap">A</span>SHUTOSH <span className="drop-cap">G</span>UPTA
        </div>
      </footer>

      {/* ── My Results Modal Popup ────────────────────────────────────────── */}
      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">🏆 My Quiz Results</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowHistoryModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {history.length === 0 ? (
                <div className="empty-history-state">
                  <span className="empty-icon">📜</span>
                  <p className="empty-title">No quiz attempts yet</p>
                  <p className="empty-subtext">
                    Complete a quiz attempt to see your saved results and performance metrics here.
                  </p>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((item, idx) => (
                    <div key={item.id || idx} className="history-card">
                      <div className="history-card-header">
                        <div>
                          <strong className="history-name">{item.studentName}</strong>
                          <span className="history-branch-chip">{item.branch}</span>
                        </div>
                        <span className={`status-badge ${item.status}`}>
                          {item.status === 'completed' ? 'Completed' : 'Attempt Ended'}
                        </span>
                      </div>

                      <div className="history-date">
                        {item.attemptDate
                          ? new Date(item.attemptDate).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : 'Recent Attempt'}
                      </div>

                      <div className="history-metrics-grid">
                        <div className="metric-box">
                          <span className="metric-label">Level Reached</span>
                          <span className="metric-val">Level {item.levelReached}</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Total Score</span>
                          <span className="metric-val">{item.totalScore} / {item.maxPossible}</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Accuracy</span>
                          <span className="metric-val">{item.accuracyPct}%</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Time Taken</span>
                          <span className="metric-val">{item.timeFormatted}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
