import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  registerStudent,
  verifyResultsAuth,
  sendSmsOtp,
  verifySmsOtp,
  resetPasswordWithOtp,
} from '../api';
import { useQuiz } from '../context/QuizContext';
import { BRANCHES, LEVELS } from '../config';

function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CUMULATIVE_MAX = { 1: 20, 2: 35, 3: 45, 4: 50 };

export default function EntryForm() {
  const navigate = useNavigate();
  const { saveStudent } = useQuiz();

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

  // Authenticated Student Performance Data
  const [authedStudentData, setAuthedStudentData] = useState(null);

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
    setAuthError('');
    setResetError('');
    setResetSuccess('');
    setShowHistoryModal(true);
  };

  // Submit Private Auth Form
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
      setModalMode('dashboard');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Invalid Mobile Number or Password/PIN.');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Step 1 & 2: Trigger SMS OTP ──────────────────────────────────────────
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
      setResendTimer(30); // 30-second resend countdown
      setModalMode('reset_otp');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed to send SMS OTP. Check mobile number.');
    } finally {
      setResetLoading(false);
    }
  };

  // ── Step 3 & 4: Verify SMS OTP ────────────────────────────────────────────
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

  // ── Step 5: Update Password & Auto-Login ─────────────────────────────────
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

      // Auto-login into results dashboard after successful reset
      const res = await verifyResultsAuth({
        mobile: resetMobile.trim(),
        password: newPassword.trim(),
      });
      setAuthedStudentData(res.data.data);
      setModalMode('dashboard');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Password update failed. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  // Calculations for private dashboard
  const isCompleted    = authedStudentData?.status === 'completed';
  const clearedLevel   = isCompleted ? 4 : (authedStudentData?.currentLevel || 1);
  const maxPossible    = CUMULATIVE_MAX[clearedLevel] || 50;
  const totalScore     = authedStudentData?.totalScore ?? 0;
  const totalTimeTaken = authedStudentData?.totalTimeTaken ?? 0;
  const accuracyPct    = maxPossible > 0 ? Math.min(100, Math.round((totalScore / maxPossible) * 100)) : 0;
  const timeFormatted  = formatTimeMMSS(totalTimeTaken);

  return (
    <div className="entry-page">
      {/* Sleek Top-Right "My Results" Badge */}
      <button
        type="button"
        className="my-results-btn"
        onClick={handleOpenResultsModal}
        title="Access your private quiz results"
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

      {/* ── Private "My Results" Auth & Performance Modal ──────────────────── */}
      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {modalMode === 'dashboard' ? '📊 Private Performance Summary' :
                 modalMode.startsWith('reset') ? '📱 SMS OTP Password Reset' :
                 '🔒 Private Results Authentication'}
              </h2>
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
              {/* ── MODE 1: Authentication Form ── */}
              {modalMode === 'auth' && (
                <form onSubmit={handleAuthSubmit} className="auth-form" noValidate>
                  <p className="auth-subtitle">
                    Enter your registered Mobile Number & Password/PIN to view your private results.
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
                  {resetSuccess && <div className="form-success-banner">{resetSuccess}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary form-submit-btn"
                    disabled={authLoading}
                  >
                    {authLoading ? <><span className="btn-spinner" />Authenticating…</> : 'View My Results →'}
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

                  {/* 30-Second Resend Timer */}
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
                    {resetLoading ? <><span className="btn-spinner" />Updating…</> : 'Update Password & View Results →'}
                  </button>
                </form>
              )}

              {/* ── MODE 5: Private Performance Dashboard ── */}
              {modalMode === 'dashboard' && authedStudentData && (
                <div className="private-dashboard">
                  <div className="dashboard-header-card">
                    <div>
                      <h3 className="candidate-name">{authedStudentData.name}</h3>
                      <p className="candidate-sub">
                        {authedStudentData.branch} · {authedStudentData.mobile}
                      </p>
                    </div>
                    <span className={`status-badge ${authedStudentData.status}`}>
                      {isCompleted ? 'Completed' : 'Attempt Ended'}
                    </span>
                  </div>

                  <div className="dashboard-metrics-grid">
                    <div className="metric-card">
                      <span className="metric-title">Level Reached</span>
                      <span className="metric-value">Level {clearedLevel}</span>
                    </div>

                    <div className="metric-card">
                      <span className="metric-title">Total Score</span>
                      <span className="metric-value">{totalScore} / {maxPossible}</span>
                    </div>

                    <div className="metric-card">
                      <span className="metric-title">Accuracy Rate</span>
                      <span className="metric-value">{accuracyPct}%</span>
                    </div>

                    <div className="metric-card">
                      <span className="metric-title">Total Time Taken</span>
                      <span className="metric-value">{timeFormatted}</span>
                    </div>
                  </div>

                  {authedStudentData.updatedAt && (
                    <div className="dashboard-date">
                      Attempt Date:{' '}
                      {new Date(authedStudentData.updatedAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  )}

                  <div className="dashboard-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setModalMode('auth')}
                    >
                      🔒 Lock & Log Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
