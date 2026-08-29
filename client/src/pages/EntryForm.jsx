import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  registerStudent,
  verifyResultsAuth,
  sendSmsOtp,
  verifySmsOtp,
  resetPasswordWithOtp,
  deleteStudentAttempt,
} from '../api';
import { useQuiz } from '../context/QuizContext';
import { BRANCHES, LEVELS } from '../config';
import QrModal from '../components/QrModal';
import ThemeToggle from '../components/ThemeToggle';

function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CUMULATIVE_MAX = { 1: 20, 2: 35, 3: 45, 4: 50 };
const HISTORY_STORAGE_KEY = 'quiz_attempts_history';

export default function EntryForm() {
  const navigate = useNavigate();
  const { saveStudent } = useQuiz();

  // QR Modal state
  const [showQrModal, setShowQrModal] = useState(false);

  // Registration Form state
  const [form, setForm] = useState({ name: '', mobile: '', branch: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // Private "My Results" Modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [modalMode, setModalMode] = useState('auth');
  // Modes: 'auth' | 'reset_mobile' | 'reset_otp' | 'reset_new_password' | 'dashboard'

  // Auth Form state
  const [authForm, setAuthForm] = useState({ mobile: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // SMS OTP Reset state
  const [resetMobile, setResetMobile] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // 30-Second Resend OTP Timer
  const [resendTimer, setResendTimer] = useState(0);

  // Multi-Attempt Dashboard & Detail View State
  const [authedStudentData, setAuthedStudentData] = useState(null);
  const [attemptsList, setAttemptsList] = useState([]);
  const [selectedAttemptDetail, setSelectedAttemptDetail] = useState(null); // Clicked attempt for full detail view
  const [deleteConfirmAttempt, setDeleteConfirmAttempt] = useState(null); // Attempt object to delete
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    let interval = null;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [resendTimer]);

  // Registration validation
  const validate = () => {
    const e = {};
    if (!form.name.trim())            e.name     = 'Full name is required.';
    if (!/^\d{10}$/.test(form.mobile)) e.mobile   = 'Enter a valid 10-digit mobile number.';
    if (!form.branch)                  e.branch   = 'Please select your branch.';
    if (!form.password.trim() || form.password.trim().length < 4) {
      e.password = 'Create a Password/PIN (at least 4 digits/characters).';
    }
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
        name:     form.name.trim(),
        mobile:   form.mobile.trim(),
        branch:   form.branch,
        password: form.password.trim(),
      });
      const student = res.data.data;
      saveStudent(student);

      navigate(`/quiz/${student.currentLevel}`);
    } catch (err) {
      setServerError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Open My Results Modal
  const handleOpenResultsModal = () => {
    setModalMode('auth');
    setAuthForm({ mobile: form.mobile || '', password: '' });
    setSelectedAttemptDetail(null);
    setAuthError('');
    setResetError('');
    setResetSuccess('');
    setShowHistoryModal(true);
  };

  // Submit Private Auth Form -> opens Attempt History Dashboard
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(authForm.mobile)) {
      setAuthError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (!authForm.password.trim()) {
      setAuthError('Please enter your Password/PIN.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await verifyResultsAuth({
        mobile: authForm.mobile.trim(),
        password: authForm.password.trim(),
      });
      const studentData = res.data.data;
      setAuthedStudentData(studentData);

      // Merge backend database attemptHistory with localStorage attempts
      let combined = studentData.attemptHistory || [];
      try {
        const localSaved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
        const matchingLocal = localSaved.filter((a) => a.mobile === authForm.mobile.trim());
        
        const combinedMap = new Map();
        [...matchingLocal, ...combined].forEach((item) => {
          const key = item._id || item.id || item.attemptId || `${item.totalScore}_${item.totalTimeTaken}`;
          if (!combinedMap.has(key)) combinedMap.set(key, item);
        });
        combined = Array.from(combinedMap.values());
      } catch { /* noop */ }

      if (combined.length === 0 && studentData.status && studentData.status !== 'in-progress') {
        const isCompleted  = studentData.status === 'completed';
        const clearedLevel = isCompleted ? 4 : (studentData.currentLevel || 1);
        const maxPossible  = CUMULATIVE_MAX[clearedLevel] || 50;
        const totalScore   = studentData.totalScore ?? 0;
        const totalTime    = studentData.totalTimeTaken ?? 0;
        const accuracyPct  = maxPossible > 0 ? Math.min(100, Math.round((totalScore / maxPossible) * 100)) : 0;

        combined = [{
          attemptId: `${studentData.mobile}_${Date.now()}`,
          attemptNumber: 1,
          attemptDate: studentData.updatedAt || new Date().toISOString(),
          levelReached: clearedLevel,
          totalScore,
          maxPossible,
          accuracyPct,
          totalTimeTaken: totalTime,
          timeFormatted: formatTimeMMSS(totalTime),
          status: studentData.status,
          levelsSummary: studentData.levels || [],
        }];
      }

      combined.sort((a, b) => new Date(b.attemptDate || b.createdAt) - new Date(a.attemptDate || a.createdAt));
      setAttemptsList(combined);
      setModalMode('dashboard');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Invalid Mobile Number or Password/PIN.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Step 1 & 2: Trigger SMS OTP
  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    if (!/^\d{10}$/.test(resetMobile)) {
      setResetError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    setOtpNotice('');
    try {
      const res = await sendSmsOtp({ mobile: resetMobile.trim() });
      const demoOtpMsg = res.data.demoOtp ? ` [Demo OTP: ${res.data.demoOtp}]` : '';
      setOtpNotice(`4-digit OTP sent to +91 ${resetMobile.trim()}.${demoOtpMsg}`);
      setResendTimer(30);
      setModalMode('reset_otp');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed to send SMS OTP. Check mobile number.');
    } finally {
      setResetLoading(false);
    }
  };

  // Step 3 & 4: Verify SMS OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(otpCode.trim())) {
      setResetError('Please enter the 4-digit OTP code sent to your mobile.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    try {
      await verifySmsOtp({
        mobile: resetMobile.trim(),
        otp: otpCode.trim(),
      });
      setModalMode('reset_new_password');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Invalid OTP code. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  // Step 5: Update Password & Auto-Login
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.trim().length < 4) {
      setResetError('New password must be at least 4 characters or digits.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    try {
      await resetPasswordWithOtp({
        mobile: resetMobile.trim(),
        otp: otpCode.trim(),
        newPassword: newPassword.trim(),
      });

      const res = await verifyResultsAuth({
        mobile: resetMobile.trim(),
        password: newPassword.trim(),
      });
      const studentData = res.data.data;
      setAuthedStudentData(studentData);
      setAttemptsList(studentData.attemptHistory || []);
      setModalMode('dashboard');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Password update failed. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  // Delete Attempt Handler
  const handleDeleteAttemptConfirm = async () => {
    if (!deleteConfirmAttempt || !authedStudentData) return;
    const targetId = deleteConfirmAttempt._id || deleteConfirmAttempt.id || deleteConfirmAttempt.attemptId;

    setDeleteLoading(true);
    try {
      try {
        await deleteStudentAttempt({
          mobile: authedStudentData.mobile,
          password: authForm.password.trim(),
          attemptId: targetId,
        });
      } catch { /* noop fallback */ }

      try {
        const localSaved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
        const updatedLocal = localSaved.filter((a) => {
          const id = a._id || a.id || a.attemptId;
          return id !== targetId && a.attemptDate !== deleteConfirmAttempt.attemptDate;
        });
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedLocal));
      } catch { /* noop */ }

      setAttemptsList((prev) => prev.filter((a) => {
        const id = a._id || a.id || a.attemptId;
        return id !== targetId && a.attemptDate !== deleteConfirmAttempt.attemptDate;
      }));

      // Close detail view if currently open attempt was deleted
      if (selectedAttemptDetail && (selectedAttemptDetail._id || selectedAttemptDetail.attemptId) === targetId) {
        setSelectedAttemptDetail(null);
      }

      setDeleteConfirmAttempt(null);
    } catch (err) {
      alert('Failed to delete attempt: ' + (err.response?.data?.error || err.message));
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="entry-page">
      {/* Top Action Bar: Theme Toggle, QR Code, My Results */}
      <div className="entry-top-actions">
        <ThemeToggle />
        <button
          type="button"
          className="qr-trigger-btn"
          onClick={() => setShowQrModal(true)}
          title="Show Quiz Direct Access QR Code"
        >
          📱 <span className="btn-text">QR Code</span>
        </button>
        <button
          type="button"
          className="my-results-btn"
          onClick={handleOpenResultsModal}
          title="Access your private quiz attempts history"
        >
          🏆 <span className="btn-text">My Results</span>
        </button>
      </div>

      <QrModal isOpen={showQrModal} onClose={() => setShowQrModal(false)} />

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

          {/* Password / PIN Setup */}
          <div className="form-group">
            <label className="form-label" htmlFor="password">Create Password / 4-Digit PIN</label>
            <input
              id="password" name="password" type="password"
              className={`form-input${errors.password ? ' form-input-error' : ''}`}
              placeholder="Set a secret Password or PIN"
              value={form.password}
              onChange={handleChange}
              maxLength={20}
            />
            {errors.password ? (
              <p className="form-error">{errors.password}</p>
            ) : (
              <p className="form-hint">Used to privately view your results after the quiz.</p>
            )}
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

      {/* Footer Attribution Badge */}
      <footer className="author-attribution-badge">
        <div className="cinematic-gold-branding">
          <span className="drop-cap">C</span>REATED <span className="small-word">BY</span> ~ <span className="drop-cap">A</span>SHUTOSH <span className="drop-cap">G</span>UPTA
        </div>
      </footer>

      {/* ── Private "My Results" Auth & Multi-Attempt History Modal ───────────── */}
      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {selectedAttemptDetail ? `📊 Attempt #${selectedAttemptDetail.attemptNum} Detailed Report` :
                 modalMode === 'dashboard' ? '🏆 Attempt History Dashboard' :
                 modalMode.startsWith('reset') ? '📱 SMS OTP Password Reset' :
                 '🔒 Private Results Authentication'}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  if (selectedAttemptDetail) {
                    setSelectedAttemptDetail(null);
                  } else {
                    setShowHistoryModal(false);
                  }
                }}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* ── MODE 1: Authentication Form ── */}
              {modalMode === 'auth' && (
                <form onSubmit={handleAuthSubmit} className="auth-form" noValidate>
                  <p className="auth-subtitle">
                    Enter your registered Mobile Number & Password/PIN to access your private Attempt History.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Registered Mobile Number</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="10-digit mobile number"
                      value={authForm.mobile}
                      onChange={(e) => setAuthForm({ ...authForm, mobile: e.target.value })}
                      maxLength={10}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Password / PIN</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter your secret Password or PIN"
                      value={authForm.password}
                      onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                    />
                  </div>

                  {authError && <div className="server-error" role="alert">{authError}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary form-submit-btn"
                    disabled={authLoading}
                  >
                    {authLoading ? <><span className="btn-spinner" />Authenticating…</> : 'View Attempt History →'}
                  </button>

                  <div className="modal-footer-link">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setResetMobile(authForm.mobile || '');
                        setResetError('');
                        setOtpNotice('');
                        setModalMode('reset_mobile');
                      }}
                    >
                      Forgot / Reset Password via SMS OTP?
                    </button>
                  </div>
                </form>
              )}

              {/* ── MODE 2 (Step 1 & 2): SMS Mobile Input ── */}
              {modalMode === 'reset_mobile' && (
                <form onSubmit={handleSendOtp} className="auth-form" noValidate>
                  <p className="auth-subtitle">
                    Enter your registered 10-digit Mobile Number to receive a 4-digit SMS OTP.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Registered Mobile Number</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="10-digit mobile number"
                      value={resetMobile}
                      onChange={(e) => setResetMobile(e.target.value)}
                      maxLength={10}
                    />
                  </div>

                  {resetError && <div className="server-error" role="alert">{resetError}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary form-submit-btn"
                    disabled={resetLoading}
                  >
                    {resetLoading ? <><span className="btn-spinner" />Sending OTP…</> : 'Send 4-Digit OTP via SMS →'}
                  </button>

                  <div className="modal-footer-link">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setModalMode('auth')}
                    >
                      ← Back to Results Login
                    </button>
                  </div>
                </form>
              )}

              {/* ── MODE 3 (Step 3 & 4): 4-Digit OTP Verification Screen ── */}
              {modalMode === 'reset_otp' && (
                <form onSubmit={handleVerifyOtp} className="auth-form" noValidate>
                  <p className="auth-subtitle">
                    Enter the 4-digit OTP code sent to <strong>+91 {resetMobile}</strong>.
                  </p>

                  {otpNotice && <div className="form-success-banner">{otpNotice}</div>}

                  <div className="form-group">
                    <label className="form-label">4-Digit SMS OTP</label>
                    <input
                      type="text"
                      className="form-input otp-input"
                      placeholder="• • • •"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      maxLength={4}
                      inputMode="numeric"
                      autoFocus
                    />
                  </div>

                  {resetError && <div className="server-error" role="alert">{resetError}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary form-submit-btn"
                    disabled={resetLoading}
                  >
                    {resetLoading ? <><span className="btn-spinner" />Verifying…</> : 'Verify OTP →'}
                  </button>

                  <div className="resend-timer-wrapper">
                    {resendTimer > 0 ? (
                      <span className="resend-timer-text">
                        Resend OTP in <strong>{resendTimer}s</strong>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link-btn resend-btn"
                        onClick={handleSendOtp}
                        disabled={resetLoading}
                      >
                        Didn't receive OTP? <strong>Resend OTP</strong>
                      </button>
                    )}
                  </div>
                </form>
              )}

              {/* ── MODE 4 (Step 5): Set New Password Screen ── */}
              {modalMode === 'reset_new_password' && (
                <form onSubmit={handleUpdatePassword} className="auth-form" noValidate>
                  <p className="auth-subtitle">
                    OTP Verified! Set a new secret Password or PIN for your account.
                  </p>

                  <div className="form-group">
                    <label className="form-label">New Password / PIN</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter new Password or PIN"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      maxLength={20}
                      autoFocus
                    />
                  </div>

                  {resetError && <div className="server-error" role="alert">{resetError}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary form-submit-btn"
                    disabled={resetLoading}
                  >
                    {resetLoading ? <><span className="btn-spinner" />Updating…</> : 'Update Password & View History →'}
                  </button>
                </form>
              )}

              {/* ── MODE 5: Multi-Attempt History Dashboard / Detailed View ── */}
              {modalMode === 'dashboard' && authedStudentData && (
                <div className="multi-attempt-dashboard">
                  {/* If an individual attempt card is clicked, show Detailed Performance Summary Modal */}
                  {selectedAttemptDetail ? (
                    <div className="attempt-detail-view">
                      <div className="detail-view-header">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedAttemptDetail(null)}
                        >
                          ← Back to History List
                        </button>
                        <span className={`status-badge ${selectedAttemptDetail.status}`}>
                          {selectedAttemptDetail.status === 'completed' ? 'Completed' : 'Attempt Ended'}
                        </span>
                      </div>

                      {/* Hero Summary Card */}
                      <div className="detail-hero-card">
                        <div className="detail-hero-icon">
                          {selectedAttemptDetail.status === 'completed' ? '🏆' : '⚡'}
                        </div>
                        <h3 className="detail-hero-title">
                          {selectedAttemptDetail.status === 'completed'
                            ? 'Quiz Completed Successfully!'
                            : `Attempt Ended at Level ${selectedAttemptDetail.clearedLvl}`}
                        </h3>
                        <p className="detail-hero-meta">
                          {authedStudentData.name} ({authedStudentData.branch}) ·{' '}
                          {selectedAttemptDetail.attemptDate
                            ? new Date(selectedAttemptDetail.attemptDate).toLocaleString(undefined, {
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
                          <span className="detail-metric-val">Level {selectedAttemptDetail.clearedLvl} of 4</span>
                        </div>
                        <div className="detail-metric-card">
                          <span className="detail-metric-label">Total Score (All Levels)</span>
                          <span className="detail-metric-val">{selectedAttemptDetail.score} / {selectedAttemptDetail.maxPoss}</span>
                        </div>
                        <div className="detail-metric-card">
                          <span className="detail-metric-label">Accuracy Rate</span>
                          <span className="detail-metric-val">{selectedAttemptDetail.accuracy}%</span>
                        </div>
                        <div className="detail-metric-card">
                          <span className="detail-metric-label">Total Time Taken</span>
                          <span className="detail-metric-val">{formatTimeMMSS(selectedAttemptDetail.timeSecs)}</span>
                        </div>
                      </div>

                      {/* Per-Level Breakdown */}
                      <div className="detail-breakdown-card">
                        <h4 className="breakdown-title">📋 Level-by-Level Breakdown</h4>
                        {selectedAttemptDetail.levelsSummary && selectedAttemptDetail.levelsSummary.length > 0 ? (
                          <div className="level-summary-list">
                            {selectedAttemptDetail.levelsSummary.map((lvlItem, i) => (
                              <div key={i} className="level-summary-item">
                                <div>
                                  <strong>Level {lvlItem.level}</strong>
                                  <span className="level-subtext">
                                    Time: {formatTimeMMSS(lvlItem.timeTaken || 0)}
                                  </span>
                                </div>
                                <span className="level-score-pill">
                                  Score: {lvlItem.score} pts
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="breakdown-simple-rows">
                            <div className="report-row">
                              <span>Highest Level Cleared:</span>
                              <strong>Level {selectedAttemptDetail.clearedLvl}</strong>
                            </div>
                            <div className="report-row">
                              <span>Questions Attempted:</span>
                              <strong>{selectedAttemptDetail.maxPoss} Questions</strong>
                            </div>
                            <div className="report-row">
                              <span>Total Score Earned:</span>
                              <strong>{selectedAttemptDetail.score} / {selectedAttemptDetail.maxPoss} Correct</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Attempt Cards History List */
                    <>
                      <div className="dashboard-user-bar">
                        <div>
                          <h3 className="user-name">{authedStudentData.name}</h3>
                          <p className="user-sub">
                            {authedStudentData.branch} · {authedStudentData.mobile}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setModalMode('auth')}
                        >
                          🔒 Log Out
                        </button>
                      </div>

                      {attemptsList.length === 0 ? (
                        <div className="empty-history-state">
                          <span className="empty-icon">📜</span>
                          <p className="empty-title">No completed attempts recorded</p>
                          <p className="empty-subtext">
                            Complete a quiz round to see your attempt history listed here.
                          </p>
                        </div>
                      ) : (
                        <div className="attempts-history-list">
                          {attemptsList.map((attempt, index) => {
                            const attemptId = attempt._id || attempt.id || attempt.attemptId || index;
                            const attemptNum = attempt.attemptNumber || (attemptsList.length - index);
                            const isCompletedAttempt = attempt.status === 'completed';
                            const clearedLvl = isCompletedAttempt ? 4 : (attempt.levelReached || 1);
                            const maxPoss = attempt.maxPossible || CUMULATIVE_MAX[clearedLvl] || 50;
                            const score = attempt.totalScore ?? 0;
                            const timeSecs = attempt.totalTimeTaken ?? 0;
                            const accuracy = attempt.accuracyPct ?? (maxPoss > 0 ? Math.round((score / maxPoss) * 100) : 0);

                            const cardDetailData = {
                              ...attempt,
                              attemptNum,
                              clearedLvl,
                              maxPoss,
                              score,
                              timeSecs,
                              accuracy,
                            };

                            return (
                              <div
                                key={attemptId}
                                className="attempt-history-card"
                                onClick={() => setSelectedAttemptDetail(cardDetailData)}
                                title="Click to view full detailed performance summary"
                              >
                                <div className="attempt-card-main">
                                  <div className="attempt-card-header">
                                    <div className="attempt-badge-title">
                                      <span className="attempt-number-badge">Attempt #{attemptNum}</span>
                                      <span className="attempt-timestamp">
                                        {attempt.attemptDate || attempt.createdAt
                                          ? new Date(attempt.attemptDate || attempt.createdAt).toLocaleString(undefined, {
                                              dateStyle: 'medium',
                                              timeStyle: 'short',
                                            })
                                          : 'Recent Attempt'}
                                      </span>
                                    </div>

                                    <div className="attempt-actions-row">
                                      <span className={`status-badge ${attempt.status}`}>
                                        {isCompletedAttempt ? 'Completed' : 'Attempt Ended'}
                                      </span>
                                      {/* Delete Attempt Button — stops event propagation */}
                                      <button
                                        type="button"
                                        className="delete-attempt-btn"
                                        onClick={(e) => {
                                          e.stopPropagation(); // Prevents card click / detail modal trigger
                                          setDeleteConfirmAttempt({ ...attempt, attemptNum });
                                        }}
                                        title="Delete this attempt record"
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  </div>

                                  {/* Metrics Grid */}
                                  <div className="attempt-metrics-grid">
                                    <div className="metric-box">
                                      <span className="metric-label">Level Reached</span>
                                      <span className="metric-val">Level {clearedLvl}</span>
                                    </div>
                                    <div className="metric-box">
                                      <span className="metric-label">Total Score</span>
                                      <span className="metric-val">{score} / {maxPoss}</span>
                                    </div>
                                    <div className="metric-box">
                                      <span className="metric-label">Accuracy</span>
                                      <span className="metric-val">{accuracy}%</span>
                                    </div>
                                    <div className="metric-box">
                                      <span className="metric-label">Time Taken</span>
                                      <span className="metric-val">{formatTimeMMSS(timeSecs)}</span>
                                    </div>
                                  </div>

                                  <div className="click-view-hint">
                                    <span>🔍 Click card for full detailed report →</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Attempt Confirmation Modal ───────────────────────────────── */}
      {deleteConfirmAttempt && (
        <div className="modal-backdrop confirm-delete-backdrop">
          <div className="modal-card confirm-delete-card">
            <div className="delete-modal-icon">⚠️</div>
            <h3 className="delete-modal-title">Delete Attempt Record?</h3>
            <p className="delete-modal-text">
              Are you sure you want to permanently delete <strong>Attempt #{deleteConfirmAttempt.attemptNum}</strong>?
              This record will be permanently removed from your results history and cannot be recovered.
            </p>

            <div className="delete-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteConfirmAttempt(null)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteAttemptConfirm}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : 'Delete Permanently 🗑️'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
