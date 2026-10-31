import { useState, useEffect, useCallback } from 'react';
import { getCaptcha } from '../api';

/**
 * Reusable <Captcha /> component.
 * Displays SVG captcha, input field, and refresh button.
 * Automatically loads new captcha on mount and on wrong/expired verification.
 */
export default function Captcha({
  captchaId,
  setCaptchaId,
  captchaAnswer,
  setCaptchaAnswer,
  disabled = false,
  error = '',
  refreshTrigger = 0,
  idPrefix = 'form',
}) {
  const [svg, setSvg] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getCaptcha();
      if (res.data?.captchaId && res.data?.svg) {
        setCaptchaId(res.data.captchaId);
        setSvg(res.data.svg);
        setCaptchaAnswer('');
      }
    } catch (err) {
      console.warn('[Captcha] Failed to fetch captcha:', err.message);
    } finally {
      setLoading(false);
    }
  }, [setCaptchaId, setCaptchaAnswer]);

  // Load on mount and whenever refreshTrigger changes
  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha, refreshTrigger]);

  return (
    <div className="captcha-wrapper">
      <label className="form-label" htmlFor={`${idPrefix}-captcha-input`}>
        Security Verification <span style={{ color: 'var(--danger)' }}>*</span>
      </label>

      <div className="captcha-display-row">
        <div
          className="captcha-svg-container"
          dangerouslySetInnerHTML={{
            __html: svg || '<span className="captcha-loading-text">Loading CAPTCHA…</span>',
          }}
          title="Security CAPTCHA"
          aria-label="Security CAPTCHA image"
        />

        <button
          type="button"
          className="captcha-refresh-btn"
          onClick={fetchCaptcha}
          disabled={disabled || loading}
          title="Refresh CAPTCHA"
          aria-label="Get new CAPTCHA"
        >
          <span className={`refresh-icon ${loading ? 'spinning' : ''}`} aria-hidden>
            🔄
          </span>
        </button>
      </div>

      <div className="captcha-input-container">
        <input
          id={`${idPrefix}-captcha-input`}
          type="text"
          className={`form-input captcha-input ${error ? 'form-input-error' : ''}`}
          placeholder="Enter 5 characters above"
          value={captchaAnswer}
          onChange={(e) => setCaptchaAnswer(e.target.value)}
          maxLength={6}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
        />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

