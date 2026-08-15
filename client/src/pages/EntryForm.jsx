import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerStudent } from '../api';
import { useQuiz } from '../context/QuizContext';
import { BRANCHES, LEVELS } from '../config';

export default function EntryForm() {
  const navigate = useNavigate();
  const { saveStudent } = useQuiz();

  const [form, setForm] = useState({ name: '', mobile: '', branch: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

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

      // If resumed and already eliminated/completed, go to results
      if (student.status === 'eliminated' || student.status === 'completed') {
        navigate('/results');
      } else {
        navigate(`/quiz/${student.currentLevel}`);
      }
    } catch (err) {
      setServerError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="entry-page">
      <div className="entry-card">
        <div className="entry-logo" aria-hidden>🎓</div>
        <h1 className="entry-title">Freshers Orientation Quiz</h1>
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
    </div>
  );
}
