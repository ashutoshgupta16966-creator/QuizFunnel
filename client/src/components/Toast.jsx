import { useEffect } from 'react';

const ICONS = {
  error:   '✕',
  warning: '⚠',
  success: '✓',
  info:    'ℹ',
};

/**
 * Toast — floating notification at the bottom of the screen.
 * Auto-dismisses after `duration` ms (default 4s).
 *
 * Props:
 *   message  — string to display
 *   type     — 'error' | 'warning' | 'success' | 'info'
 *   duration — milliseconds before auto-close (default 4000)
 *   onClose  — callback when toast is dismissed
 */
export default function Toast({ message, type = 'info', duration = 4000, onClose }) {
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  return (
    <div className={`toast ${type}`} role="alert" aria-live="polite">
      <span aria-hidden>{ICONS[type]}</span>
      <span>{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}
